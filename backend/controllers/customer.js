
import mongoose from "mongoose";
import Unit from "../models/Unit.js";
import Business from "../models/business.js";
import Booking from "../models/Booking.js";
import asyncHandler from "express-async-handler";
import { v4 as uuidv4 } from "uuid";
import { deleteImages, uploadBookingDocument } from "../utils/uploadImgs.js";
import { getStripe } from "../config/stripe.js";
import { getFrontendUrl } from "../config/env.js";
import { calculateBookingPrice, reconcileExpiredHolds } from "../services/booking.js";
import { expireCheckoutSession } from "../services/booking.js";
import { reconcileBookingPayment } from "../services/booking.js";
import { activeBusinessFilter, findActiveBusiness, validateGuests } from "../services/catalog.js";


const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// @route  GET /api/customer/units
// @access Private/customer
export const getAllUnits = asyncHandler(async (req, res) => {
    const businesses = await Business.find(await activeBusinessFilter()).select("_id");
    const allunits = await Unit.find({ active: true, businessId: { $in: businesses.map((item) => item._id) } });

    res.status(200).json({
        success: true,
        message: 'all units retrived',
        data: allunits
    })

});

// @route  GET /api/customer/businesses
// @access Private/customer
export const getAllBusinesses = asyncHandler(async (req, res) => {
    const allBusinesses = await Business.find(await activeBusinessFilter());

    res.status(200).json({
        success: true,
        data: allBusinesses
    })

});

// @route  GET /api/customer/units/:id
// @access Private/customer
export const getUnitById = asyncHandler(async (req, res) => {
    const unitId = req.params.id

    if(!mongoose.Types.ObjectId.isValid(unitId)) {
        throw createError(400, 'invalid id')
    }

    const unit = await Unit.findOne({ _id: unitId, active: true })

    if(!unit) {
        throw createError(404, 'Unit not found')
    }
    const business = await findActiveBusiness(unit.businessId);
    if (!business) throw createError(404, 'Unit not found');

    res.status(200).json({
        success: true,
        data: unit
    })

});

// @route  GET /api/customer/business/:id
// @access Private/customer
export const getBusinessById = asyncHandler(async (req, res) => {
    const businessId = req.params.id

    if(!mongoose.Types.ObjectId.isValid(businessId)) {
        throw createError(400, 'invalid business id')
    }

    const business = await findActiveBusiness(businessId)

    if(!business) {
        throw createError(404, 'Business not found')
    }

    res.status(200).json({
        success: true,
        data: business
    })

});

export const getUnitAvailability = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw createError(400, "Invalid unit ID");
  const unit = await Unit.findOne({ _id: req.params.id, active: true });
  if (!unit) throw createError(404, "Unit not found");
  const business = await findActiveBusiness(unit.businessId);
  if (!business) throw createError(404, "Unit not found");
  const price = calculateBookingPrice(unit, req.query.startDate, req.query.endDate);
  const guests = validateGuests(unit, req.query.guests);
  await reconcileExpiredHolds(unit._id, price.start, price.end, getStripe());
  const conflict = await Booking.exists({
    unitId: unit._id, status: { $in: ["progress", "confirmed"] },
    startDate: { $lt: price.end }, endDate: { $gt: price.start },
  });
  res.status(200).json({ success: true, data: {
    available: !conflict, unitId: unit._id, guests, startDate: price.start, endDate: price.end,
    unitPrice: price.unitPrice, currency: price.currency, quantity: price.quantity,
    subtotal: price.subtotal, fees: price.fees, totalAmount: price.totalAmount,
  } });
});

// @route  POST /api/customer/booking
// @access Private/customer
export const createBooking = asyncHandler(async (req, res) => {
  const { unitId, businessId, startDate, endDate } = req.body || {};
  if (!req.user?._id) throw createError(401, "Authentication required");
  if (req.user.role !== "customer") throw createError(403, "Customer access required");
  if (!mongoose.isObjectIdOrHexString(unitId) || !mongoose.isObjectIdOrHexString(businessId)) {
    throw createError(400, "Valid unit and business IDs are required");
  }
  const files = req.file ? [req.file] : (req.files || []);
  if (!Array.isArray(files) || files.length > 1) throw createError(400, "Upload only one document image");

  const unit = await Unit.findById(unitId);
  if (!unit) throw createError(404, "Unit not found");
  if (!unit.active) throw createError(409, "This unit is not available for booking");
  if (unit.businessId.toString() !== businessId.toLowerCase()) {
    throw createError(400, "This unit does not belong to this business");
  }
  const business = await Business.findById(businessId);
  if (!business) throw createError(404, "Business not found");
  if (business.status !== "active") throw createError(409, "This business is unavailable");
  if (!await findActiveBusiness(businessId)) throw createError(409, "This business is unavailable");
  validateGuests(unit, req.body.guests);
  const price = calculateBookingPrice(unit, startDate, endDate);
  const frontendUrl = getFrontendUrl();
  const stripe = getStripe();
  await reconcileExpiredHolds(unit._id, price.start, price.end, stripe);

  let document;
  let booking;
  let checkoutSession;
  try {
    if (files.length) document = await uploadBookingDocument(files[0]);

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        // A write to the same Unit makes concurrent booking transactions conflict.
        // The retried transaction then sees the winning hold in the overlap query.
        const lockedUnit = await Unit.findOneAndUpdate(
          { _id: unitId, active: true }, { $inc: { bookingRevision: 1 } },
          { session: dbSession, returnDocument: "after" }
        );
        if (!lockedUnit) throw createError(409, "This unit is unavailable");
        const currentBusiness = await findActiveBusiness(businessId, dbSession);
        if (!currentBusiness || lockedUnit.businessId.toString() !== businessId.toLowerCase()) {
          throw createError(409, "This business or unit is unavailable");
        }
        const currentPrice = calculateBookingPrice(lockedUnit, startDate, endDate);
        const guests = validateGuests(lockedUnit, req.body.guests);
        const conflict = await Booking.exists({
          unitId: lockedUnit._id, status: { $in: ["progress", "confirmed"] },
          startDate: { $lt: currentPrice.end }, endDate: { $gt: currentPrice.start },
        }).session(dbSession);
        if (conflict) {
          const ownHold = await Booking.findOne({ unitId: lockedUnit._id, customerId: req.user._id,
            startDate: currentPrice.start, endDate: currentPrice.end,
            status: "progress", isValid: false }).session(dbSession);
          const error = createError(409, ownHold
            ? "You already have an unpaid booking for these dates. Open My bookings to resume payment or cancel the hold."
            : "This unit is already reserved for these dates");
          throw error;
        }
        [booking] = await Booking.create([{
          unitId: lockedUnit._id, businessId: currentBusiness._id, customerId: req.user._id,
          code: uuidv4(), document, startDate: currentPrice.start, endDate: currentPrice.end,
          status: "progress", isValid: false, paymentStatus: "unpaid", guests,
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
          unitPrice: currentPrice.unitPrice, currency: currentPrice.currency,
          quantity: currentPrice.quantity, subtotal: currentPrice.subtotal,
          fees: currentPrice.fees, totalAmount: currentPrice.totalAmount,
          amountMinor: currentPrice.amountMinor,
        }], { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }

    checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment", customer_email: req.user.email,
      line_items: [{ price_data: {
        currency: booking.currency.toLowerCase(), unit_amount: booking.amountMinor,
        product_data: { name: unit.title },
      }, quantity: 1 }],
      metadata: { bookingId: booking._id.toString() },
      success_url: `${frontendUrl}/payment/success?bookingId=${booking._id}`,
      cancel_url: `${frontendUrl}/payment/cancel?bookingId=${booking._id}`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    }, { idempotencyKey: `booking-${booking._id}` });

    const saved = await Booking.updateOne(
      { _id: booking._id, status: "progress", isValid: false },
      { $set: { stripeSessionId: checkoutSession.id,
        expiresAt: new Date(checkoutSession.expires_at * 1000) } }
    );
    if (saved.modifiedCount !== 1) throw createError(409, "Booking hold expired before checkout was ready");
  } catch (error) {
    let sessionExpired = !checkoutSession;
    if (checkoutSession) {
      try {
        await stripe.checkout.sessions.expire(checkoutSession.id);
        sessionExpired = true;
      } catch (cleanupError) {
        console.error("Checkout Session expiration failed:", cleanupError.name);
      }
    }
    if (booking && sessionExpired) {
      await Booking.updateOne(
        { _id: booking._id, status: "progress", isValid: false },
        { $set: { status: "expired", paymentStatus: "failed" } }
      );
    }
    if (document?.publicId && sessionExpired) {
      await deleteImages([document]).catch((cleanupError) => console.error("Booking document cleanup failed:", cleanupError.name));
    }
    throw error;
  }

  return res.status(201).json({
    success: true, message: "Booking held. Complete payment to confirm it.",
    data: {
      id: booking._id, code: booking.code, status: "progress", paymentStatus: "unpaid",
      startDate: booking.startDate, endDate: booking.endDate, expiresAt: new Date(checkoutSession.expires_at * 1000),
      unitId: booking.unitId, businessId: booking.businessId,
      unitPrice: booking.unitPrice, currency: booking.currency, quantity: booking.quantity,
      subtotal: booking.subtotal, fees: booking.fees, totalAmount: booking.totalAmount,
    },
    checkoutUrl: checkoutSession.url,
  });
});

const CUSTOMER_BOOKING_FIELDS = "unitId businessId code status isValid paymentStatus startDate endDate " +
  "unitPrice currency quantity subtotal fees totalAmount confirmedAt expiresAt createdAt guests";

export const syncMyBookingPayment = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw createError(400, "Invalid booking ID");
  const booking = await Booking.findOne({ _id: req.params.id, customerId: req.user._id });
  if (!booking) throw createError(404, "Booking not found");
  await reconcileBookingPayment(booking, getStripe());
  const data = await Booking.findById(booking._id).select(CUSTOMER_BOOKING_FIELDS)
    .populate("unitId", "code title images").populate("businessId", "name city category");
  res.json({ success: true, data });
});

export const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ customerId: req.user._id })
    .select(CUSTOMER_BOOKING_FIELDS)
    .populate("unitId", "code title images")
    .populate("businessId", "name city category")
    .sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: bookings });
});

export const getMyBookingById = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw createError(400, "Invalid booking ID");
  const booking = await Booking.findOne({ _id: req.params.id, customerId: req.user._id })
    .select(CUSTOMER_BOOKING_FIELDS + " stripeSessionId amountMinor")
    .populate("unitId", "code title images")
    .populate("businessId", "name city category");
  if (!booking) throw createError(404, "Booking not found");
  let checkout;
  // Explicitly requested by the resume-payment action. Reading a browser return
  // never confirms a booking. Only the verified Stripe payment workflow does.
  if (req.query.includeCheckout === "true" && booking.status === "progress" && !booking.isValid) {
    if (!booking.stripeSessionId) {
      if (booking.expiresAt && booking.expiresAt <= new Date()) {
        const expired = await Booking.updateOne({ _id: booking._id, status: "progress", isValid: false,
          stripeSessionId: { $exists: false } }, { $set: { status: "expired", paymentStatus: "expired" } });
        if (expired.modifiedCount === 1) {
          booking.status = "expired"; booking.paymentStatus = "expired";
          checkout = { state: "expired" };
        } else checkout = { state: "preparing" };
      } else checkout = { state: "preparing" };
    } else {
      const session = await getStripe().checkout.sessions.retrieve(booking.stripeSessionId);
      if (session.id !== booking.stripeSessionId || session.metadata?.bookingId !== booking._id.toString() ||
          session.mode !== "payment" || session.amount_total !== booking.amountMinor ||
          session.currency?.toUpperCase() !== booking.currency) {
        throw createError(409, "The payment session does not match this booking");
      }
      if (session.status === "expired") {
        await expireCheckoutSession(session, `resume-${session.id}`);
        const current = await Booking.findById(booking._id).select("status isValid paymentStatus");
        booking.status = current.status; booking.isValid = current.isValid; booking.paymentStatus = current.paymentStatus;
        checkout = { state: "expired" };
      } else if (session.status === "open" && session.payment_status === "unpaid") {
        const available = await Unit.exists({ _id: booking.unitId?._id, active: true });
        const activeBusiness = await findActiveBusiness(booking.businessId?._id);
        if (!available || !activeBusiness) throw createError(409, "This unit is no longer available. Cancel the unpaid hold.");
        checkout = { state: "open", url: session.url };
      } else {
        checkout = { state: "awaiting_confirmation" };
      }
    }
  }
  const data = booking.toObject();
  delete data.stripeSessionId; delete data.amountMinor;
  if (checkout) data.checkout = checkout;
  res.status(200).json({ success: true, data });
});

export const cancelPendingBooking = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw createError(400, "Invalid booking ID");
  const booking = await Booking.findOne({ _id: req.params.id, customerId: req.user._id });
  if (!booking) throw createError(404, "Booking not found");
  if (booking.status !== "progress" || booking.isValid) {
    throw createError(409, "Only unpaid pending bookings can be cancelled here");
  }
  if (booking.stripeSessionId) {
    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
    if (checkout.payment_status === "paid") {
      // Keep the paid reservation protected while its verified webhook is pending.
      // A customer request must never perform the payment-confirmation transition.
      throw createError(409, "Payment has completed; cancellation requires a refund request");
    }
    if (checkout.status === "open") await stripe.checkout.sessions.expire(checkout.id);
    else if (checkout.status !== "expired") {
      throw createError(409, "Payment is processing; this booking cannot be cancelled yet");
    }
  }
  const result = await Booking.updateOne(
    { _id: booking._id, customerId: req.user._id, status: "progress", isValid: false },
    { $set: { status: "cancelled", paymentStatus: "expired" } }
  );
  if (result.modifiedCount !== 1) throw createError(409, "Booking state changed; reload and try again");
  res.status(200).json({ success: true, message: "Pending booking cancelled" });
});
