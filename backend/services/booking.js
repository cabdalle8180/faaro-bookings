import Booking from "../models/Booking.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const bookingError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const calculateBookingPrice = (unit, startDate, endDate, now = new Date()) => {
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    throw bookingError(400, "Start and end dates must be date strings");
  }
  const parseDate = (value) => {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
    if (Number.isNaN(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) {
      throw bookingError(400, "Invalid start or end date");
    }
    return { date, dateOnly };
  };
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start.date >= end.date) throw bookingError(400, "End date must be after start date");
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (start.date < (start.dateOnly ? todayUtc : now)) {
    throw bookingError(400, "Start date cannot be in the past");
  }
  const quantity = Math.ceil((end.date - start.date) / DAY_MS);
  if (quantity < 1 || quantity > 365) throw bookingError(400, "Booking duration must be 1–365 days");
  if (unit.currency !== "USD" || !Number.isFinite(unit.price) || unit.price < 1 ||
      Math.abs(unit.price * 100 - Math.round(unit.price * 100)) >= 1e-6) {
    throw bookingError(400, "This unit has an invalid price or currency");
  }
  const unitMinor = Math.round(unit.price * 100);
  const amountMinor = unitMinor * quantity;
  if (!Number.isSafeInteger(unitMinor) || !Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    throw bookingError(400, "Booking amount is invalid");
  }
  return {
    start: start.date,
    end: end.date,
    unitPrice: unitMinor / 100,
    currency: "USD",
    quantity,
    subtotal: amountMinor / 100,
    fees: 0,
    totalAmount: amountMinor / 100,
    amountMinor,
  };
};

// Accept only a signature-verified event or a session retrieved with our Stripe secret.
// Both paths share the same atomic transition and validate the stored price snapshot.
export const confirmCheckoutSession = async (checkout, eventId) => {
  const booking = await Booking.findOne({
    _id: checkout.metadata?.bookingId,
    stripeSessionId: checkout.id,
  });
  if (!booking) return false;
  if (booking.status === "confirmed" && booking.isValid) return false;
  if (booking.status !== "progress" || booking.isValid) return false;
  if (checkout.mode !== "payment" || checkout.status !== "complete" || checkout.payment_status !== "paid" ||
      checkout.amount_total !== booking.amountMinor ||
      checkout.currency?.toUpperCase() !== booking.currency) {
    throw bookingError(409, "Stripe payment does not match the booking amount");
  }
  const paymentIntentId = typeof checkout.payment_intent === "string"
    ? checkout.payment_intent : checkout.payment_intent?.id;
  const result = await Booking.updateOne(
    { _id: booking._id, stripeSessionId: checkout.id, status: "progress", isValid: false },
    { $set: {
      status: "confirmed", isValid: true, paymentStatus: "paid", confirmedAt: new Date(),
      stripePaymentIntentId: paymentIntentId, ...(eventId ? { lastStripeEventId: eventId } : {}),
    } }
  );
  return result.modifiedCount === 1;
};

export const reconcileBookingPayment = async (booking, stripe) => {
  if (booking.status !== "progress" || booking.isValid || !booking.stripeSessionId) return;
  const checkout = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
  if (checkout.id !== booking.stripeSessionId || checkout.metadata?.bookingId !== String(booking._id) ||
      checkout.mode !== "payment" || checkout.amount_total !== booking.amountMinor ||
      checkout.currency?.toUpperCase() !== booking.currency) {
    throw bookingError(409, "The payment session does not match this booking");
  }
  if (checkout.status === "complete" && checkout.payment_status === "paid") {
    await confirmCheckoutSession(checkout);
  } else if (checkout.status === "expired" && checkout.payment_status !== "paid") {
    await expireCheckoutSession(checkout);
  }
  return checkout;
};

export const expireCheckoutSession = async (checkout, eventId, paymentStatus = "expired") => {
  if (checkout.payment_status === "paid") return false;
  const result = await Booking.updateOne(
    { _id: checkout.metadata?.bookingId, stripeSessionId: checkout.id,
      status: "progress", isValid: false },
    { $set: { status: "expired", paymentStatus, ...(eventId ? { lastStripeEventId: eventId } : {}) } }
  );
  return result.modifiedCount === 1;
};

// Release an overdue hold only after Stripe confirms that payment cannot complete.
// A crash before storing a Checkout Session is safe to release after the short setup TTL.
export const reconcileExpiredHolds = async (unitId, start, end, stripe, now = new Date()) => {
  const overdue = await Booking.find({
    unitId, status: "progress", isValid: false, expiresAt: { $lte: now },
    startDate: { $lt: end }, endDate: { $gt: start },
  });
  for (const booking of overdue) {
    if (!booking.stripeSessionId) {
      await Booking.updateOne(
        { _id: booking._id, status: "progress", isValid: false, stripeSessionId: { $exists: false } },
        { $set: { status: "expired", paymentStatus: "expired" } }
      );
      continue;
    }
    let checkout = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
    if (checkout.payment_status === "paid") {
      // Do not release a paid hold or confirm it from an availability request.
      // Only a signature-verified successful Checkout event may confirm payment.
      continue;
    } else if (checkout.status === "expired") {
      await expireCheckoutSession(checkout, `reconcile-${checkout.id}`);
    } else if (checkout.status === "open" && checkout.expires_at <= Math.floor(now.getTime() / 1000)) {
      checkout = await stripe.checkout.sessions.expire(checkout.id);
      if (checkout.status === "expired") await expireCheckoutSession(checkout, `reconcile-${checkout.id}`);
    }
  }
};
