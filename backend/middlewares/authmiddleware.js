import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";

export const protect = asyncHandler(async (req, res, next) => {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : null;

  if (!token) {
    res.status(401);
    throw new Error("Authentication required");
  }

  const decoded = jwt.verify(
    token,
    process.env.ACCESS_TOKEN_SECRET,
    { algorithms: ["HS256"] }
  );

  const user = await User.findById(decoded.id).select(
    "-password -verificationToken -verificationTokenExpire " +
      "-resetPasswordToken -resetPasswordTokenExpire"
  );

  if (!user) {
    res.status(401);
    throw new Error("User account not found");
  }

  if ((decoded.version ?? 0) !== (user.tokenVersion ?? 0)) {
    res.status(401);
    throw new Error("Session has expired");
  }

  if (user.status !== "active") {
    res.status(403);
    throw new Error("This account is suspended");
  }

  req.user = user;
  next();
});

export const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access required"));
  }

  next();
};

export const ownerOnly = (req, res, next) => {
  if (req.user?.role !== "owner") {
    res.status(403);
    return next(new Error("Owner access required"));
  }

  next();
};
