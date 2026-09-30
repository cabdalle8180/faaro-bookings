import Unit from "../models/Unit.js";
import Business from "../models/business.js";
import Booking from "../models/Booking.js";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import uploadImages, { deleteImages } from "../utils/uploadImgs.js";
import cloudinary, { configureCloudinary } from "../config/cloudinary.js";

const ownerError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const retainedImages = (images, input) => {
  if (input === undefined) return [...images];
  let ids = input;
  if (typeof ids === "string") {
    try { ids = JSON.parse(ids); } catch { throw ownerError(400, "Invalid retained image IDs"); }
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length ||
      ids.some((id) => !images.some((image) => image.publicId === id))) {
    throw ownerError(400, "Retained images must belong to this record");
  }
  return ids.map((id) => images.find((image) => image.publicId === id));
};
const businessFields = ["name", "description", "category", "contactPhone", "city", "address", "openHours"];
const businessInput = (body, creating = false) => {
  if (body.ownerId !== undefined || body.status !== undefined) {
    throw ownerError(403, "Business ownership and suspension status cannot be changed here");
  }
  const result = {};
  for (const field of businessFields) {
    const value = body[field];
    if (value === undefined && !creating) continue;
    if (field === "description" && value === undefined) continue;
    if (typeof value !== "string" || (field !== "description" && !value.trim())) {
      throw ownerError(400, `${field} must be a non-empty string`);
    }
    result[field] = value.trim();
  }
  if (result.category && !["hotel", "car_rental", "apartment"].includes(result.category)) {
    throw ownerError(400, "Category must be hotel, car_rental, or apartment");
  }
  return result;
};

// Owner role comes from protect + ownerOnly. Public registration cannot grant it.
export const createMyBusiness = asyncHandler(async (req, res) => {
  const fields = businessInput(req.body ?? {}, true);
  await Business.init();
  if (await Business.exists({ ownerId: req.user._id })) throw ownerError(409, "You already have a business");
  const images = await uploadImages(req.files ?? []);
  try {
    const business = await Business.create({ ...fields, ownerId: req.user._id, images });
    res.status(201).json({ success: true, message: "Business created successfully", data: business });
  } catch (error) {
    await deleteImages(images).catch((cleanupError) => console.error("Business image cleanup failed:", cleanupError.name));
    throw error;
  }
});

export const updateMyBusiness = asyncHandler(async (req, res) => {
  const fields = businessInput(req.body ?? {});
  const business = await Business.findOne({ ownerId: req.user._id });
  if (!business) throw ownerError(404, "Business not found");
  if (business.status !== "active") throw ownerError(403, "This business is suspended");
  if (fields.category && fields.category !== business.category) {
    throw ownerError(409, "Business category cannot be changed after creation");
  }
  const retained = retainedImages(business.images, req.body?.retainedImageIds);
  const removed = business.images.filter((image) => !retained.some((item) => item.publicId === image.publicId));
  if (retained.length + (req.files?.length || 0) > 5) throw ownerError(400, "A business can have up to 5 images");
  Object.assign(business, fields);
  await business.validate();
  const images = await uploadImages(req.files ?? []);
  try {
    business.images = [...retained, ...images];
    await business.save();
    await deleteImages(removed).catch((error) => console.error("Removed business image cleanup failed:", error.name));
    res.status(200).json({ success: true, message: "Business updated successfully", data: business });
  } catch (error) {
    await deleteImages(images).catch((cleanupError) => console.error("Business image cleanup failed:", cleanupError.name));
    throw error;
  }
});

export const getMyUnitById = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw ownerError(400, "Invalid unit ID");
  const business = await Business.findOne({ ownerId: req.user._id });
  if (!business) throw ownerError(404, "Business not found");
  const unit = await Unit.findOne({ _id: req.params.id, businessId: business._id });
  if (!unit) throw ownerError(404, "Unit not found");
  res.status(200).json({ success: true, data: unit });
});

const activeValue = (value, fallback) => {
  if (value === undefined) return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw ownerError(400, "active must be true or false");
};

export const getMyBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ ownerId: req.user._id });
  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }
  res.status(200).json({ success: true, data: business });
});

export const getMyUnits = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ ownerId: req.user._id });
  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }
  const units = await Unit.find({ businessId: business._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: units });
});

// @route  POST /api/business/units/
// @access Private/Owner
export const createUnit = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ ownerId: req.user._id });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (business.status !== "active") {
    res.status(403);
    throw new Error("This business is suspended");
  }

  const body = req.body ?? {};
  const price = Number(body.price);

  if (!Number.isFinite(price) || price < 1 ||
      Math.abs(price * 100 - Math.round(price * 100)) >= 1e-6) {
    res.status(400);
    throw new Error("Price must be at least 1 USD with at most two decimal places");
  }

  let details = body.details;

  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      res.status(400);
      throw new Error("Details must be valid JSON");
    }
  }

  const detailKey =
    business.category === "car_rental" ? "car" : business.category;

  if (
    !details?.[detailKey] ||
    typeof details[detailKey] !== "object" ||
    Array.isArray(details[detailKey])
  ) {
    res.status(400);
    throw new Error(`Please provide details.${detailKey}`);
  }

  const unit = new Unit({
    businessId: business._id,
    code: body.code,
    title: body.title,
    description: body.description,
    address: body.address,
    price,
    currency: "USD",
    active: activeValue(body.active, true),
    details: { [detailKey]: details[detailKey] },
  });

  await unit.validate();

  const existingUnit = await Unit.exists({
    businessId: business._id,
    code: unit.code,
  });

  if (existingUnit) {
    res.status(409);
    throw new Error("This unit code already exists in your business");
  }

  const images = await uploadImages(req.files ?? []);
  try {
    unit.images = images;
    await unit.save();
  } catch (error) {
    await deleteImages(images).catch((cleanupError) => console.error("Unit image cleanup failed:", cleanupError));
    throw error;
  }

  res.status(201).json({
    success: true,
    message: "Unit created successfully",
    data: unit,
  });
});

// @route  PATCH /api/business/units/:id
// @access Private/Owner
export const updateUnit = asyncHandler(async (req, res) => {
  const unitId = req.params.id;

  if (!mongoose.isObjectIdOrHexString(unitId)) {
    res.status(400);
    throw new Error("Invalid unit ID");
  }

  const business = await Business.findOne({ ownerId: req.user._id });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (business.status !== "active") {
    res.status(403);
    throw new Error("This business is suspended");
  }

  const unit = await Unit.findOne({
    _id: unitId,
    businessId: business._id,
  });

  if (!unit) {
    res.status(404);
    throw new Error("Unit not found");
  }

  const body = req.body ?? {};

  for (const field of [
    "code",
    "title",
    "description",
    "address",
  ]) {
    if (body[field] !== undefined) {
      unit[field] = body[field];
    }
  }
  unit.active = activeValue(body.active, unit.active);
  const retained = retainedImages(unit.images, body.retainedImageIds);
  const removed = unit.images.filter((image) => !retained.some((item) => item.publicId === image.publicId));
  if (retained.length + (req.files?.length || 0) > 5) throw ownerError(400, "A unit can have up to 5 images");

  if (body.price !== undefined) {
    const price = Number(body.price);

    if (!Number.isFinite(price) || price < 1 ||
        Math.abs(price * 100 - Math.round(price * 100)) >= 1e-6) {
      res.status(400);
      throw new Error("Price must be at least 1 USD with at most two decimal places");
    }

    unit.price = price;
  }

  if (body.details !== undefined) {
    let details = body.details;

    if (typeof details === "string") {
      try {
        details = JSON.parse(details);
      } catch {
        res.status(400);
        throw new Error("Details must be valid JSON");
      }
    }

    const detailKey =
      business.category === "car_rental" ? "car" : business.category;

    if (
      !details?.[detailKey] ||
      typeof details[detailKey] !== "object" ||
      Array.isArray(details[detailKey])
    ) {
      res.status(400);
      throw new Error(`Please provide details.${detailKey}`);
    }

    unit.details = {
      [detailKey]: {
        ...unit.details?.[detailKey]?.toObject(),
        ...details[detailKey],
      },
    };
  }

  await unit.validate();

  if (body.code !== undefined) {
    const existingUnit = await Unit.exists({
      businessId: business._id,
      code: unit.code,
      _id: { $ne: unit._id },
    });

    if (existingUnit) {
      res.status(409);
      throw new Error("This unit code already exists in your business");
    }
  }

  const images = await uploadImages(req.files ?? []);
  try {
    unit.images = [...retained, ...images];
    await unit.save();
    await deleteImages(removed).catch((error) => console.error("Removed unit image cleanup failed:", error.name));
  } catch (error) {
    await deleteImages(images).catch((cleanupError) => console.error("Unit image cleanup failed:", cleanupError));
    throw error;
  }

  res.status(200).json({
    success: true,
    message: "Unit updated successfully",
    data: unit,
  });
});

// @route  DELETE /api/business/units/:id
// @access Private/Owner
export const deleteUnit = asyncHandler(async (req, res) => {
  const unitId = req.params.id;

  if (!mongoose.isObjectIdOrHexString(unitId)) {
    res.status(400);
    throw new Error("Invalid unit ID");
  }

  const business = await Business.findOne({ ownerId: req.user._id });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  const unit = await Unit.findOne({
    _id: unitId,
    businessId: business._id,
  });

  if (!unit) {
    res.status(404);
    throw new Error("Unit not found");
  }

  if (unit.active) {
    unit.active = false;
    await unit.save();
  }

  res.status(200).json({
    success: true,
    message: "Unit deactivated successfully",
    data: unit,
  });
});

// @route  GET /api/business/booking/
// @access Private/Owner
export const getAllBookings = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ ownerId: req.user._id });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  const bookings = await Booking.find({
    businessId: business._id,
    isValid: true,
  }).select("-document")
    .populate("unitId", "code title currency")
    .populate("customerId", "fullName email phone")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: bookings,
  });
});

// @route  GET /api/business/booking/:id
// @access Private/Owner
export const getBookingById = asyncHandler(async (req, res) => {
  const bookingId = req.params.id;

  if (!mongoose.isObjectIdOrHexString(bookingId)) {
    res.status(400);
    throw new Error("Invalid booking ID");
  }

  const business = await Business.findOne({ ownerId: req.user._id });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  const booking = await Booking.findOne({
    _id: bookingId,
    businessId: business._id,
    isValid: true,
  })
    .populate("unitId", "code title currency")
    .populate("customerId", "fullName email phone");

  if (!booking) {
    res.status(404);
    throw new Error("Paid booking not found");
  }

  const result = booking.toObject();
  if (result.document?.deliveryType === "authenticated" && result.document.publicId && result.document.format) {
    configureCloudinary();
    result.documentAccessUrl = cloudinary.utils.private_download_url(
      result.document.publicId, result.document.format,
      { resource_type: "image", type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 300 }
    );
  } else if (result.document?.url) {
    // Legacy documents were uploaded publicly; retain access until migrated.
    result.documentAccessUrl = result.document.url;
  }
  delete result.document;
  res.status(200).json({
    success: true,
    data: result,
  });
});

// @route  POST /api/business/check-booking/:id
// @access Private/Owner
export const CheckBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params.id;
  const { booking_code } = req.body ?? {};

  if (!mongoose.isObjectIdOrHexString(bookingId)) {
    res.status(400);
    throw new Error("Invalid booking ID");
  }

  if (typeof booking_code !== "string" || !booking_code.trim()) {
    res.status(400);
    throw new Error("Booking code is required");
  }

  const business = await Business.findOne({ ownerId: req.user._id });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  const booking = await Booking.findOne({
    _id: bookingId,
    businessId: business._id,
    isValid: true,
  }).select("-document")
    .populate("unitId", "code title")
    .populate("customerId", "fullName email phone");

  if (!booking) {
    res.status(404);
    throw new Error("Paid booking not found");
  }

  if (booking.code !== booking_code.trim()) {
    res.status(400);
    throw new Error("Invalid booking code");
  }

  if (booking.status !== "confirmed" && booking.status !== "progress") {
    res.status(400);
    throw new Error("This booking is cancelled or expired");
  }

  if (booking.endDate <= new Date()) {
    res.status(400);
    throw new Error("This booking has expired");
  }

  res.status(200).json({
    success: true,
    message: "Booking verified successfully",
    data: booking,
  });
});
