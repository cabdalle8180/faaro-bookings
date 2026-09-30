import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import Business from "../models/business.js";
import Unit from "../models/Unit.js";
import Booking from "../models/Booking.js";
import { activeBusinessFilter, findActiveBusiness, unitCapacity, validateGuests } from "../services/catalog.js";
import { bookingError, calculateBookingPrice } from "../services/booking.js";

const businessFields = "name description category city address contactPhone openHours images.url status";
const unitFields = "businessId title description address images.url price currency active details.hotel details.apartment details.car.make details.car.model details.car.seats";
const checkId = (id) => { if (!mongoose.isObjectIdOrHexString(id)) throw bookingError(400, "Invalid ID"); };

export const publicBusinesses = asyncHandler(async (req, res) => {
  const data = await Business.find(await activeBusinessFilter()).select(businessFields).sort({ createdAt: -1 });
  res.json({ success: true, data });
});

export const publicBusiness = asyncHandler(async (req, res) => {
  checkId(req.params.id);
  const data = await Business.findOne({ _id: req.params.id, ...await activeBusinessFilter() }).select(businessFields);
  if (!data) throw bookingError(404, "Business not found");
  res.json({ success: true, data });
});

export const publicUnits = asyncHandler(async (req, res) => {
  const businesses = await Business.find(await activeBusinessFilter()).select(businessFields).lean();
  const businessById = new Map(businesses.map((item) => [String(item._id), item]));
  const { category, q, businessId, min, max, guests, startDate, endDate } = req.query;
  for (const value of [category, q, businessId, min, max, guests, startDate, endDate]) {
    if (value !== undefined && typeof value !== "string") throw bookingError(400, "Invalid search parameter");
  }
  if (businessId) checkId(businessId);
  const price = {};
  for (const [key, value] of [["$gte", min], ["$lte", max]]) {
    if (value !== undefined && value !== "") {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) throw bookingError(400, "Invalid price filter");
      price[key] = Number(value);
    }
  }
  if (price.$gte > price.$lte) throw bookingError(400, "Maximum price must be at least the minimum");
  if (guests) validateGuests({}, guests);
  const filter = { active: true, businessId: { $in: businesses.filter((business) =>
    (!businessId || String(business._id) === businessId) && (!category || category === "all" || business.category === category)
  ).map((business) => business._id) } };
  if (Object.keys(price).length) filter.price = price;
  if (startDate || endDate) {
    const dates = calculateBookingPrice({ price: 1, currency: "USD" }, startDate, endDate);
    const reserved = await Booking.distinct("unitId", { status: { $in: ["progress", "confirmed"] },
      startDate: { $lt: dates.end }, endDate: { $gt: dates.start } });
    filter._id = { $nin: reserved };
  }
  let data = await Unit.find(filter).select(unitFields).sort({ createdAt: -1 }).lean();
  const query = q?.trim().toLowerCase();
  data = data.filter((unit) => {
    const business = businessById.get(String(unit.businessId));
    return (!guests || unitCapacity(unit) >= Number(guests)) && (!query ||
      [unit.title, unit.description, unit.address, business.name, business.city, business.address]
        .some((value) => value?.toLowerCase().includes(query)));
  });
  res.json({ success: true, data });
});

export const publicUnit = asyncHandler(async (req, res) => {
  checkId(req.params.id);
  const data = await Unit.findOne({ _id: req.params.id, active: true }).select(unitFields);
  if (!data || !await findActiveBusiness(data.businessId)) throw bookingError(404, "Unit not found");
  res.json({ success: true, data });
});

export const publicAvailability = asyncHandler(async (req, res) => {
  checkId(req.params.id);
  const unit = await Unit.findOne({ _id: req.params.id, active: true });
  if (!unit || !await findActiveBusiness(unit.businessId)) throw bookingError(404, "Unit not found");
  const guests = validateGuests(unit, req.query.guests);
  const price = calculateBookingPrice(unit, req.query.startDate, req.query.endDate);
  const conflict = await Booking.exists({ unitId: unit._id, status: { $in: ["progress", "confirmed"] },
    startDate: { $lt: price.end }, endDate: { $gt: price.start } });
  res.json({ success: true, data: { available: !conflict, unitId: unit._id, guests,
    startDate: price.start, endDate: price.end, unitPrice: price.unitPrice, currency: price.currency,
    quantity: price.quantity, subtotal: price.subtotal, fees: price.fees, totalAmount: price.totalAmount } });
});
