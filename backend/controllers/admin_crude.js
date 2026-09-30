import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import Business from "../models/business.js"
import uploadImages, { deleteImages } from "../utils/uploadImgs.js";

const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const USER_FIELDS = "fullName email phone role status isVerified createdAt";


// @route  POST /api/admin/users/suspend/:id
// @access Private/Admin
export const suspendUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isObjectIdOrHexString(id)) {
    throw createError(400, "Invalid user ID");
  }

  const adminId = req.user?._id?.toString();

  if (adminId && adminId === id.toLowerCase()) {
    throw createError(400, "You cannot suspend your own account");
  }

  const user = await User.findById(id);

  if (!user) {
    throw createError(404, "User not found");
  }

  const wasAlreadySuspended = user.status === "suspended";

  if (!wasAlreadySuspended) {
    user.status = "suspended";
    await user.save();
  }

  return res.status(200).json({
    success: true,
    message: wasAlreadySuspended
      ? "User is already suspended"
      : "User suspended successfully",
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  });
});

// @route  POST /api/admin/users/businessOwner/:id
// @access Private/Admin
export const createBusiness = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isObjectIdOrHexString(id)) {
    throw createError(400, "Invalid user ID");
  }

  const body = req.body ?? {};
  const {
    name,
    description,
    contactPhone,
    city,
    address,
    openHours,
  } = body;

  const category =
    typeof body.category === "string"
      ? body.category.trim().toLowerCase()
      : "";

  for (const [field, value] of Object.entries({
    name,
    contactPhone,
    city,
    address,
    openHours,
  })) {
    if (typeof value !== "string" || !value.trim()) {
      throw createError(400, `${field} is required`);
    }
  }

  if (!["hotel", "car_rental", "apartment"].includes(category)) {
    throw createError(
      400,
      "Category must be hotel, car_rental, or apartment"
    );
  }

  if (description !== undefined && typeof description !== "string") {
    throw createError(400, "Description must be a string");
  }

  const files = req.files ?? [];

  if (!Array.isArray(files)) {
    throw createError(400, "Images must be an array");
  }

  // Check before uploading, then check again inside the transaction
  // in case the user's state changes while images are uploading.
  const getEligibleUser = async (session = null) => {
    const user = await User.findById(id).session(session);

    if (!user) {
      throw createError(404, "User not found");
    }

    if (user.status !== "active") {
      throw createError(409, "A suspended user cannot become a business owner");
    }

    if (user.role === "admin") {
      throw createError(409, "An admin cannot become a business owner");
    }

    const existingBusiness = await Business.exists({
      ownerId: user._id,
    }).session(session);

    if (existingBusiness) {
      throw createError(409, "This user already has a business");
    }

    if (user.role !== "customer") {
      throw createError(409, "Only a customer can become a business owner");
    }

    return user;
  };

  await getEligibleUser();

  let uploadedImgs = [];
  let result;
  let committed = false;

  try {
    uploadedImgs = await uploadImages(files);

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const user = await getEligibleUser(session);

        const [business] = await Business.create(
          [
            {
              ownerId: user._id,
              name: name.trim(),
              description: description?.trim(),
              category,
              contactPhone: contactPhone.trim(),
              city: city.trim(),
              address: address.trim(),
              openHours: openHours.trim(),
              images: uploadedImgs,
            },
          ],
          { session }
        );

        user.role = "owner";
        await user.save({ session });

        result = { user, business };
      });

      committed = true;
    } finally {
      await session.endSession();
    }
  } catch (error) {
    // If the database operation failed, remove images uploaded for it.
    // An unknown commit result needs reconciliation: the business may
    // have committed, so deleting its images would be unsafe.
    if (
      uploadedImgs.length > 0 &&
      !committed &&
      !error.hasErrorLabel?.("UnknownTransactionCommitResult")
    ) {
      try {
        await deleteImages(uploadedImgs);
      } catch (cleanupError) {
        console.error("Business image cleanup failed:", cleanupError);
      }
    }

    if (
      error.code === 11000 &&
      (error.keyPattern?.ownerId || error.keyValue?.ownerId)
    ) {
      throw createError(409, "This user already has a business");
    }

    throw error;
  }

  return res.status(201).json({
    success: true,
    message: "Business owner created successfully",
    user: {
      id: result.user._id,
      fullName: result.user.fullName,
      email: result.user.email,
      role: result.user.role,
      status: result.user.status,
    },
    business: result.business,
  });
});

// @route  GET /api/admin/users/
// @access Private/Admin
export const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select(USER_FIELDS);

  if (users.length === 0) {
    throw createError(404, "No users found");
  }

  res.status(200).json({
    success: true,
    message: 'all users are fetched',
    data: users
  })
});

// @route  GET /api/admin/users/owners
// @access Private/Admin
export const getAllBusiness = asyncHandler(async (req, res) => {
  const businesses = await Business.find();

  if (businesses.length === 0) {
    throw createError(404, "No businesses found");
  }

  res.status(200).json({
    success: true,
    message: 'businesses are retrived successfully',
    data: businesses
  })
})