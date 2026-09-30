import User from "../models/User.js";
import asyncHandler from "express-async-handler";
import sendMail from "../utils/sendmail.js";
import generateToken from "../utils/generateToken.js";
import { refreshCookieOptions } from "../utils/refreshCookie.js";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { parseHttpUrl } from "../config/env.js";


const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 24;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const normalizeEmail = (email) => email.trim().toLowerCase();
const normalizePhone = (phone) => phone.trim();

const getClientUrl = () => {
  // CLIENT_URL is preferred. Client_URI supports your existing environment variable.
  const value = process.env.CLIENT_URL || process.env.Client_URI;

  if (!value) {
    throw new Error("CLIENT_URL is not configured");
  }

  return parseHttpUrl(value, "CLIENT_URL").origin;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });

const makeEmail = ({ title, fullName, message, actionLabel, actionUrl }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; color: #17212b;">
    <h1>${escapeHtml(title)}</h1>
    <p>Hello ${escapeHtml(fullName)},</p>
    <p>${escapeHtml(message)}</p>
    <p style="margin: 28px 0;">
      <a href="${escapeHtml(actionUrl)}"
         style="background: #087f5b; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 6px;">
        ${escapeHtml(actionLabel)}
      </a>
    </p>
    <p>If you did not request this, you can ignore this email.</p>
    <p>Faaro Team</p>
  </div>
`;

const publicUserData = (user) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  role: user.role,
});

const sendVerificationEmail = (user, token, clientUrl) => {
  const verificationUrl = `${clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: "Verify your Faaro account",
    message: makeEmail({
      title: "Welcome to Faaro",
      fullName: user.fullName,
      message: "Please verify your email address to activate your account.",
      actionLabel: "Verify email",
      actionUrl: verificationUrl,
    }),
  });
};

// @route POST /api/auth/register
// @access Public
export const register = asyncHandler(async (req, res) => {
  const { fullName, email, password, phone } = req.body ?? {};

  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof phone !== "string" ||
    !phone.trim() ||
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    res.status(400);
    throw new Error(
      `Provide your full name, email, phone, and a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
    );
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  const existingUser = await User.findOne({
    $or: [{ email: normalizedEmail }, { phone: normalizedPhone }],
  });

  if (existingUser) {
    res.status(409);
    throw new Error("An account with this email or phone already exists");
  }

  let user;

  try {
    user = await User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      password,
      // Never accept a role from the public registration request.
      role: "customer",
      // Email verification is optional for the current development/testing flow.
      isVerified: true,
    });
  } catch (error) {
    // The database unique indexes also protect against simultaneous requests.
    if (error?.code === 11000) {
      res.status(409);
      throw new Error("An account with this email or phone already exists");
    }

    throw error;
  }

  res.status(201).json({
    success: true,
    message: "Account created successfully.",
    data: publicUserData(user),
  });
});

// @route POST /api/auth/verify-email
// @access Public
export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body ?? {};

  if (typeof token !== "string" || !token) {
    res.status(400);
    throw new Error("Verification token is required");
  }

  const user = await User.findOne({
    verificationToken: hashToken(token),
    verificationTokenExpire: { $gt: new Date() },
  });

  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired verification token");
  }

  user.isVerified = true;
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;
  user.verificationTokenRequestedAt = undefined;

  // Verifying email must never grant or change the user's role.
  await user.save();

  res.status(200).json({
    success: true,
    message: "Email verified successfully",
  });
});

// @route POST /api/auth/resend-verification
// @access Public
export const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    res.status(400);
    throw new Error("Email is required");
  }

  const user = await User.findOne({ email: normalizeEmail(email) });
  const message = "If an unverified account matches, a verification link will be sent.";

  if (user && !user.isVerified) {
    const lastRequestedAt = user.verificationTokenRequestedAt?.getTime();
    if (
      !lastRequestedAt ||
      Date.now() - lastRequestedAt >= VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      const clientUrl = getClientUrl();
      const token = user.getVerificationToken();
      await user.save();
      try {
        await sendVerificationEmail(user, token, clientUrl);
      } catch (error) {
        console.error("Verification email delivery failed:", error);
      }
    }
  }

  res.status(200).json({ success: true, message });
});

// @route POST /api/auth/login
// @access Public
export const login = asyncHandler(async (req, res) => {
  const { email, phone, password } = req.body ?? {};

  const hasEmail = typeof email === "string" && email.trim().length > 0;
  const hasPhone = typeof phone === "string" && phone.trim().length > 0;

  if (
    typeof password !== "string" ||
    !password ||
    hasEmail === hasPhone
  ) {
    res.status(400);
    throw new Error("Provide a password and either email or phone");
  }

  const query = hasEmail
    ? { email: normalizeEmail(email) }
    : { phone: normalizePhone(phone) };

  // "+password" is needed if you add select: false to the password schema field.
  const user = await User.findOne(query)

  if (!user || !(await user.comparePassword(password))) {
    res.status(401);
    throw new Error("Invalid email/phone or password");
  }

  if (user.status !== "active") {
    res.status(403);
    throw new Error("This account is suspended");
  }

  const accessToken = generateToken(res, user);

  res.status(200).json({
    success: true,
    data: publicUserData(user),
    accessToken,
  });
});

// @route POST /api/auth/forgot-password
// @access Public
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email, phone } = req.body ?? {};

  const hasEmail = typeof email === "string" && email.trim().length > 0;
  const hasPhone = typeof phone === "string" && phone.trim().length > 0;

  if (hasEmail === hasPhone) {
    res.status(400);
    throw new Error("Provide either an email address or phone number");
  }

  const query = hasEmail
    ? { email: normalizeEmail(email) }
    : { phone: normalizePhone(phone) };

  const user = await User.findOne(query);

  // Same response whether the account exists or not.
  const message = "If an account matches, password reset instructions will be sent.";

  if (user?.isVerified && user.email) {
    const clientUrl = getClientUrl();
    const resetToken = user.getResetPasswordToken();

    await user.save();

    const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

    await sendMail({
      to: user.email,
      subject: "Reset your Faaro password",
      message: makeEmail({
        title: "Password reset",
        fullName: user.fullName,
        message: "Use the link below to choose a new password.",
        actionLabel: "Reset password",
        actionUrl: resetUrl,
      }),
    });
  }

  res.status(200).json({ success: true, message });
});

// @route POST /api/auth/reset-password
// @access Public
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body ?? {};

  if (typeof token !== "string" || !token) {
    res.status(400);
    throw new Error("Reset token is required");
  }

  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    res.status(400);
    throw new Error(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
    );
  }

  const user = await User.findOne({
    resetPasswordToken: hashToken(token),
    resetPasswordTokenExpire: { $gt: new Date() },
  });

  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired reset token");
  }

  user.password = password;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.resetPasswordToken = undefined;
  user.resetPasswordTokenExpire = undefined;

  await user.save();

  res.clearCookie("refreshToken", refreshCookieOptions());

  res.status(200).json({
    success: true,
    message: "Password reset successfully",
  });
});

// @route POST /api/auth/refresh
// @access Public; reads the HTTP-only refresh cookie
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    res.status(401);
    throw new Error("No refresh token provided");
  }

  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new Error("REFRESH_TOKEN_SECRET is not configured");
  }

  let decoded;

  try {
    decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET,
      { algorithms: ["HS256"] }
    );
  } catch {
    res.status(401);
    throw new Error("Invalid or expired refresh token");
  }

  if (!decoded || typeof decoded !== "object" || !decoded.id) {
    res.status(401);
    throw new Error("Invalid refresh token");
  }

  const user = await User.findById(decoded.id);

  if (!user || user.status !== "active") {
    res.status(401);
    throw new Error("User is unavailable");
  }

  if ((decoded.version ?? 0) !== (user.tokenVersion ?? 0)) {
    res.clearCookie("refreshToken", refreshCookieOptions());
    res.status(401);
    throw new Error("Session has expired");
  }

  // This creates a new access token and sets a new refresh-token cookie.
  const accessToken = generateToken(res, user);

  res.status(200).json({
    success: true,
    accessToken,
    data: { _id: user._id, fullName: user.fullName, email: user.email, phone: user.phone, role: user.role },
  });
});

// @route POST /api/auth/logout
export const logout = asyncHandler(async (req, res) => {
  res.clearCookie("refreshToken", refreshCookieOptions());

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});
