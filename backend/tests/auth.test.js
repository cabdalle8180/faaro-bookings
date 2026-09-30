import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import mongoose from "mongoose";
import net from "node:net";
import User from "../models/User.js";
import cloudinary from "../config/cloudinary.js";
import uploadImages, { uploadBookingDocument } from "../utils/uploadImgs.js";
import { createApp } from "../app.js";
import { validateEnvironment } from "../config/env.js";

const withServer = async (app, run) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

const postJson = (baseUrl, path, body, headers = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// Exercise the unchanged Nodemailer/sendMail implementation against local SMTP.
// This captures test email without delivering to any external address.
const withLocalSmtp = async (run) => {
  const messages = [];
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 localhost test SMTP\r\n");
    let buffer = "";
    let receivingData = false;
    let message = [];
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (receivingData) {
          if (line === ".") {
            messages.push(message.join("\r\n"));
            message = [];
            receivingData = false;
            socket.write("250 Message accepted\r\n");
          } else message.push(line.replace(/^\.\./, "."));
        } else if (/^(EHLO|HELO) /i.test(line)) {
          socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        } else if (/^AUTH PLAIN /i.test(line)) {
          socket.write("235 Authentication successful\r\n");
        } else if (/^(MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line)) {
          socket.write("250 OK\r\n");
        } else if (/^DATA$/i.test(line)) {
          receivingData = true;
          socket.write("354 End with a dot\r\n");
        } else if (/^QUIT$/i.test(line)) socket.end("221 Goodbye\r\n");
        else socket.write("500 Unsupported test SMTP command\r\n");
      }
    });
  });
  await new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  try {
    await run(smtp.address().port, messages);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => smtp.close(resolve));
  }
};

test("stored password hashes do not block email verification saves", async () => {
  const storedHash = await bcrypt.hash("valid-password", 4);
  const existingUser = User.hydrate({ password: storedHash });
  existingUser.getVerificationToken();

  assert.ok(storedHash.length > 24);
  assert.equal(existingUser.isModified("password"), false);
  await existingUser.validate(["password"]);

  const newUser = new User({ password: "x".repeat(25) });
  await assert.rejects(newUser.validate(["password"]), (error) => {
    assert.match(error.errors.password.message, /cannot exceed 24 characters/);
    return true;
  });
});

test("configured client origin can send credentialed refresh requests", async () => {
  const previous = process.env.CLIENT_URL;
  process.env.CLIENT_URL = "https://client.example.com/app";

  try {
    await withServer(createApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example.com",
          "access-control-request-method": "POST",
        },
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), "https://client.example.com");
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    });
  } finally {
    if (previous === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previous;
  }
});

test("image upload configures Cloudinary after environment values are available", async () => {
  const keys = ["CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_KEY_SECRET"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalUploadStream = cloudinary.uploader.upload_stream;

  try {
    process.env.CLOUD_NAME = "late-cloud";
    process.env.CLOUDINARY_API_KEY = "late-key";
    process.env.CLOUDINARY_API_KEY_SECRET = "late-secret";
    let configuredAtUpload;

    cloudinary.uploader.upload_stream = (_options, callback) => {
      configuredAtUpload = cloudinary.config();
      return {
        on() {},
        end() {
          callback(null, { secure_url: "https://example.com/image.png", public_id: "image" });
        },
      };
    };

    const images = await uploadImages([{ buffer: Buffer.from("image") }]);
    assert.deepEqual(images, [{ url: "https://example.com/image.png", publicId: "image" }]);
    assert.equal(configuredAtUpload.cloud_name, "late-cloud");
    assert.equal(configuredAtUpload.api_key, "late-key");
    assert.equal(configuredAtUpload.api_secret, "late-secret");
  } finally {
    cloudinary.uploader.upload_stream = originalUploadStream;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("booking documents use authenticated Cloudinary delivery", async () => {
  const keys = ["CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_KEY_SECRET"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalUploadStream = cloudinary.uploader.upload_stream;
  try {
    process.env.CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_KEY_SECRET = "test-secret";
    let uploadOptions;
    cloudinary.uploader.upload_stream = (options, callback) => {
      uploadOptions = options;
      return { on() {}, end() { callback(null, { public_id: "private-doc", format: "jpg" }); } };
    };
    const stored = await uploadBookingDocument({ buffer: Buffer.from("document") });
    assert.equal(uploadOptions.type, "authenticated");
    assert.equal(uploadOptions.folder, "booking-documents");
    assert.deepEqual(stored, { publicId: "private-doc", format: "jpg", deliveryType: "authenticated" });
    assert.equal(stored.url, undefined);
  } finally {
    cloudinary.uploader.upload_stream = originalUploadStream;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("legacy unverified accounts retain verification resend and its cooldown", async () => {
  const previousClientUrl = process.env.CLIENT_URL;
  const originalFindOne = User.findOne;
  const originalCreateTransport = nodemailer.createTransport;
  const originalConsoleError = console.error;
  process.env.CLIENT_URL = "https://client.example.com";
  const storedUser = new User({ fullName: "Test User", email: "test@example.com",
    phone: "12345", password: "long-password-123", isVerified: false });
  storedUser.save = async () => storedUser;
  storedUser.getVerificationToken();
  storedUser.verificationTokenRequestedAt = new Date(Date.now() - 61_000);
  let sendAttempts = 0;

  try {
    User.findOne = async (query) => (query.email ? storedUser : null);
    nodemailer.createTransport = () => ({
      sendMail: async () => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error("SMTP unavailable");
      },
    });
    console.error = () => {};

    await withServer(createApp(), async (baseUrl) => {
      const firstRequest = await postJson(baseUrl, "/api/auth/resend-verification", {
        email: "test@example.com",
      });
      assert.equal(firstRequest.status, 200);
      assert.equal(sendAttempts, 1);
      assert.ok(storedUser.verificationToken);
      const firstToken = storedUser.verificationToken;

      const tooSoon = await postJson(baseUrl, "/api/auth/resend-verification", {
        email: "test@example.com",
      });
      assert.equal(tooSoon.status, 200);
      assert.equal(sendAttempts, 1);

      storedUser.verificationTokenRequestedAt = new Date(Date.now() - 61_000);
      const retry = await postJson(baseUrl, "/api/auth/resend-verification", {
        email: "test@example.com",
      });
      assert.equal(retry.status, 200);
      assert.equal(sendAttempts, 2);
      assert.notEqual(storedUser.verificationToken, firstToken);
    });
  } finally {
    User.findOne = originalFindOne;
    nodemailer.createTransport = originalCreateTransport;
    console.error = originalConsoleError;
    if (previousClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previousClientUrl;
  }
});

test("password reset invalidates previously issued refresh tokens", async () => {
  const previousClientUrl = process.env.CLIENT_URL;
  const previousAccessSecret = process.env.ACCESS_TOKEN_SECRET;
  const previousRefreshSecret = process.env.REFRESH_TOKEN_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  process.env.CLIENT_URL = "https://client.example.com";
  process.env.ACCESS_TOKEN_SECRET = "test-access-secret";
  process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret";
  process.env.NODE_ENV = "production";
  const resetToken = "reset-token";
  const user = new User({
    fullName: "Test User",
    email: "test@example.com",
    phone: "12345",
    password: "old-password-123",
    isVerified: true,
  });
  user.save = async () => user;

  try {
    User.findOne = async (query) =>
      query.resetPasswordToken === crypto.createHash("sha256").update(resetToken).digest("hex")
        ? user
        : null;
    User.findById = () => {
      const lookup = Promise.resolve(user);
      lookup.select = () => Promise.resolve(user);
      return lookup;
    };
    const oldRefreshToken = jwt.sign(
      { id: user._id.toString(), version: 0 },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" }
    );
    const oldAccessToken = jwt.sign(
      { id: user._id.toString(), version: 0 },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    await withServer(createApp(), async (baseUrl) => {
      const before = await postJson(baseUrl, "/api/auth/refresh", {}, {
        cookie: `refreshToken=${oldRefreshToken}`,
      });
      assert.equal(before.status, 200);
      assert.match(before.headers.get("set-cookie"), /SameSite=None/);
      assert.match(before.headers.get("set-cookie"), /Secure/);

      const reset = await postJson(baseUrl, "/api/auth/reset-password", {
        token: resetToken,
        password: "new-password-123",
      });
      assert.equal(reset.status, 200);
      assert.equal(user.tokenVersion, 1);

      const after = await postJson(baseUrl, "/api/auth/refresh", {}, {
        cookie: `refreshToken=${oldRefreshToken}`,
      });
      assert.equal(after.status, 401);
      assert.match((await after.json()).message, /Session has expired/);

      const protectedResponse = await fetch(`${baseUrl}/api/admin/users/`, {
        headers: { authorization: `Bearer ${oldAccessToken}` },
      });
      assert.equal(protectedResponse.status, 401);
    });
  } finally {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    for (const [key, value] of [
      ["CLIENT_URL", previousClientUrl],
      ["ACCESS_TOKEN_SECRET", previousAccessSecret],
      ["REFRESH_TOKEN_SECRET", previousRefreshSecret],
      ["NODE_ENV", previousNodeEnv],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("registration, immediate authentication and SMTP password recovery with local MongoDB", {
  skip: !process.env.TEST_MONGODB_URI && "Set TEST_MONGODB_URI to a local replica set",
}, async (t) => {
  const mongoUrl = new URL(process.env.TEST_MONGODB_URI);
  if (mongoUrl.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(mongoUrl.hostname)) {
    throw new Error("Authentication integration tests only run against local MongoDB");
  }
  const keys = [...new Set(["NODE_ENV", "MONGODB_URI", "CLIENT_URL", "Client_URI", "FRONTEND_URL",
    "ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET", "EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS",
    ...Object.keys(process.env).filter((key) => /^(EMAIL_|SMTP_|MAIL_)/.test(key))])];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalCreateTransport = nodemailer.createTransport;
  const originalVerificationToken = User.prototype.getVerificationToken;
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  process.env.CLIENT_URL = "http://127.0.0.1:5173";
  process.env.FRONTEND_URL = "http://127.0.0.1:5173";
  process.env.ACCESS_TOKEN_SECRET = "auth-integration-access-secret";
  process.env.REFRESH_TOKEN_SECRET = "auth-integration-refresh-secret";
  for (const key of keys.filter((key) => /^(EMAIL_|SMTP_|MAIL_)/.test(key))) delete process.env[key];
  const credentials = { fullName: "Authentication Test", email: "auth-test@example.test",
    phone: `auth-${process.pid}`, password: "secure-password-123" };
  let connected = false;
  try {
    validateEnvironment();
    await mongoose.connect(process.env.TEST_MONGODB_URI, { dbName: `faaro_auth_test_${process.pid}` });
    connected = true;
    await User.init();
    await withServer(createApp(), async (baseUrl) => {
      let user;
      let accessToken;
      let refreshCookie;
      const protectedRequest = (token, path = "/api/customer/units") => fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const loginAndCheck = async (password = credentials.password) => {
        const response = await postJson(baseUrl, "/api/auth/login", { email: credentials.email, password });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.success, true);
        assert.equal(result.data._id, user._id.toString());
        assert.equal(result.data.role, "customer");
        assert.equal(result.data.password, undefined);
        accessToken = result.accessToken;
        const access = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET, { algorithms: ["HS256"] });
        assert.equal(access.id, user._id.toString());
        assert.equal(access.exp - access.iat, 15 * 60);
        const cookie = response.headers.get("set-cookie");
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
        refreshCookie = cookie.split(";")[0];
        const refresh = jwt.verify(refreshCookie.slice("refreshToken=".length), process.env.REFRESH_TOKEN_SECRET,
          { algorithms: ["HS256"] });
        assert.equal(refresh.exp - refresh.iat, 7 * 24 * 60 * 60);
      };

      await t.test("register persists verified customer with bcrypt and no SMTP or verification token", async () => {
        let mailAttempts = 0;
        let tokenAttempts = 0;
        nodemailer.createTransport = () => { mailAttempts += 1; throw new Error("Registration must not use SMTP"); };
        User.prototype.getVerificationToken = () => { tokenAttempts += 1; throw new Error("No registration token"); };
        try {
          const response = await postJson(baseUrl, "/api/auth/register", { ...credentials,
            role: "admin", status: "suspended", isVerified: false, verificationToken: "client-supplied" });
          assert.equal(response.status, 201);
          const result = await response.json();
          assert.equal(result.message, "Account created successfully.");
          assert.equal(result.data.role, "customer");
          assert.equal(result.data.password, undefined);
          user = await User.findById(result.data._id);
          assert.equal(user.isVerified, true);
          assert.equal(user.role, "customer");
          assert.equal(user.status, "active");
          assert.equal(user.tokenVersion, 0);
          assert.equal(user.verificationToken, undefined);
          assert.equal(user.verificationTokenExpire, undefined);
          assert.equal(user.verificationTokenRequestedAt, undefined);
          assert.match(user.password, /^\$2[aby]\$10\$/);
          assert.notEqual(user.password, credentials.password);
          assert.equal(await bcrypt.compare(credentials.password, user.password), true);
          assert.equal(mailAttempts, 0);
          assert.equal(tokenAttempts, 0);
        } finally {
          nodemailer.createTransport = originalCreateTransport;
          User.prototype.getVerificationToken = originalVerificationToken;
        }
      });

      await t.test("registration retains required fields, password limits and duplicate protection", async () => {
        for (const body of [{}, { ...credentials, email: "" }, { ...credentials, phone: "" },
          { ...credentials, fullName: " " }, { ...credentials, password: "x".repeat(11) },
          { ...credentials, password: "x".repeat(25) }]) {
          assert.equal((await postJson(baseUrl, "/api/auth/register", body)).status, 400);
        }
        assert.equal((await postJson(baseUrl, "/api/auth/register", { ...credentials,
          email: ` ${credentials.email.toUpperCase()} `, phone: "another-phone" })).status, 409);
        assert.equal((await postJson(baseUrl, "/api/auth/register", { ...credentials,
          email: "another@example.test" })).status, 409);
        assert.equal(await User.countDocuments(), 1);
      });

      await t.test("immediate login, refresh and protected requests retain password and role security", async () => {
        await loginAndCheck();
        assert.equal((await postJson(baseUrl, "/api/auth/login", { email: credentials.email,
          password: "incorrect-password" })).status, 401);
        assert.equal((await postJson(baseUrl, "/api/auth/login", { email: "unknown@example.test",
          password: credentials.password })).status, 401);
        const refreshed = await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: refreshCookie });
        assert.equal(refreshed.status, 200);
        const result = await refreshed.json();
        accessToken = result.accessToken;
        assert.equal(jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET).id, user._id.toString());
        assert.equal(result.data._id, user._id.toString());
        assert.equal(result.data.role, "customer");
        assert.equal(result.data.password, undefined);
        assert.equal((await protectedRequest(accessToken)).status, 200);
        assert.equal((await protectedRequest(accessToken, "/api/owner/business")).status, 403);
        assert.equal((await protectedRequest(accessToken, "/api/admin/users/")).status, 403);
        assert.equal((await fetch(`${baseUrl}/api/customer/units`)).status, 401);
        assert.equal((await protectedRequest("invalid-access-token")).status, 401);
      });

      await t.test("refresh returns the current role after owner promotion without exposing secrets", async () => {
        await User.updateOne({ _id: user._id }, { $set: { role: "owner" } });
        try {
          const response = await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: refreshCookie });
          assert.equal(response.status, 200);
          const result = await response.json();
          assert.equal(result.data.role, "owner");
          assert.deepEqual(Object.keys(result.data).sort(), ["_id", "email", "fullName", "phone", "role"]);
        } finally { await User.updateOne({ _id: user._id }, { $set: { role: "customer" } }); }
      });

      await t.test("invalid, expired, wrongly signed and stale-version refresh tokens are rejected", async () => {
        const payload = { id: user._id.toString(), version: user.tokenVersion };
        const tokens = ["invalid-refresh-token",
          jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: -1 }),
          jwt.sign(payload, "wrong-refresh-secret", { expiresIn: "7d" }),
          jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { algorithm: "HS384", expiresIn: "7d" }),
          jwt.sign({ ...payload, version: user.tokenVersion + 1 }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: "7d" }),
          jwt.sign({ ...payload, id: new mongoose.Types.ObjectId().toString() },
            process.env.REFRESH_TOKEN_SECRET, { expiresIn: "7d" })];
        assert.equal((await postJson(baseUrl, "/api/auth/refresh", {})).status, 401);
        for (const token of tokens) assert.equal((await postJson(baseUrl, "/api/auth/refresh", {}, {
          cookie: `refreshToken=${token}`,
        })).status, 401);
      });

      await t.test("legacy unverified users can login, refresh and authenticate without a migration", async () => {
        user.isVerified = false;
        await user.save();
        await loginAndCheck();
        assert.equal((await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: refreshCookie })).status, 200);
        assert.equal((await protectedRequest(accessToken)).status, 200);
        assert.equal((await User.findById(user._id)).isVerified, false);
        user.isVerified = true;
        await user.save();
      });

      await t.test("suspension and token-version changes still revoke authentication", async () => {
        user.status = "suspended";
        await user.save();
        assert.equal((await postJson(baseUrl, "/api/auth/login", { email: credentials.email,
          password: credentials.password })).status, 403);
        assert.equal((await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: refreshCookie })).status, 401);
        assert.equal((await protectedRequest(accessToken)).status, 403);
        user.status = "active";
        user.tokenVersion += 1;
        await user.save();
        assert.equal((await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: refreshCookie })).status, 401);
        assert.equal((await protectedRequest(accessToken)).status, 401);
        await loginAndCheck();
      });

      await withLocalSmtp(async (port, messages) => {
        process.env.EMAIL_HOST = "127.0.0.1";
        process.env.EMAIL_PORT = String(port);
        process.env.EMAIL_USER = "mailer@example.test";
        process.env.EMAIL_PASS = "local-test-password";
        await t.test("forgot password delivers via existing sendMail and reset preserves session revocation", async () => {
          const oldAccess = accessToken;
          const oldCookie = refreshCookie;
          const forgot = await postJson(baseUrl, "/api/auth/forgot-password", { email: credentials.email });
          assert.equal(forgot.status, 200);
          const forgotResult = await forgot.json();
          assert.equal(messages.length, 1);
          // Nodemailer may encode long HTML lines using quoted-printable.
          const mail = messages[0].replace(/=\r\n/g, "").replace(/=3D/g, "=");
          assert.match(mail, /Subject: Reset your Faaro password/);
          assert.match(mail, /To: auth-test@example.test/);
          const resetToken = mail.match(/reset-password\?token=([a-f0-9]+)/)?.[1];
          assert.ok(resetToken);
          const stored = await User.findById(user._id);
          assert.equal(stored.resetPasswordToken, crypto.createHash("sha256").update(resetToken).digest("hex"));
          assert.ok(stored.resetPasswordTokenExpire.getTime() > Date.now());
          const unknown = await postJson(baseUrl, "/api/auth/forgot-password", { email: "unknown@example.test" });
          assert.deepEqual(await unknown.json(), forgotResult);
          assert.equal(messages.length, 1);
          assert.equal((await postJson(baseUrl, "/api/auth/reset-password", { token: "invalid",
            password: "new-secure-password" })).status, 400);
          assert.equal((await postJson(baseUrl, "/api/auth/reset-password", { token: resetToken,
            password: "short" })).status, 400);
          const reset = await postJson(baseUrl, "/api/auth/reset-password", { token: resetToken,
            password: "new-secure-password" });
          assert.equal(reset.status, 200);
          assert.match(reset.headers.get("set-cookie"), /refreshToken=;/);
          user = await User.findById(user._id);
          assert.equal(await bcrypt.compare("new-secure-password", user.password), true);
          assert.equal(await bcrypt.compare(credentials.password, user.password), false);
          assert.equal(user.tokenVersion, stored.tokenVersion + 1);
          assert.equal(user.resetPasswordToken, undefined);
          assert.equal(user.resetPasswordTokenExpire, undefined);
          assert.equal((await postJson(baseUrl, "/api/auth/reset-password", { token: resetToken,
            password: "another-secure-password" })).status, 400);
          assert.equal((await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: oldCookie })).status, 401);
          assert.equal((await protectedRequest(oldAccess)).status, 401);
          assert.equal((await postJson(baseUrl, "/api/auth/login", { email: credentials.email,
            password: credentials.password })).status, 401);
          await loginAndCheck("new-secure-password");
          const refreshed = await postJson(baseUrl, "/api/auth/refresh", {}, { cookie: refreshCookie });
          assert.equal(refreshed.status, 200);
          assert.equal((await protectedRequest((await refreshed.json()).accessToken)).status, 200);
        });

        await t.test("existing verification endpoints still resend and verify legacy tokens without changing roles", async () => {
          const legacy = await User.create({ fullName: "Legacy Owner", email: "legacy@example.test",
            phone: `legacy-${process.pid}`, password: "legacy-password-123", role: "owner", isVerified: false });
          const resend = await postJson(baseUrl, "/api/auth/resend-verification", { email: legacy.email });
          assert.equal(resend.status, 200);
          assert.equal(messages.length, 2);
          const mail = messages[1].replace(/=\r\n/g, "").replace(/=3D/g, "=");
          const token = mail.match(/verify-email\?token=([a-f0-9]+)/)?.[1];
          assert.ok(token);
          assert.equal((await postJson(baseUrl, "/api/auth/verify-email", { token: "invalid" })).status, 400);
          assert.equal((await postJson(baseUrl, "/api/auth/verify-email", { token })).status, 200);
          const verified = await User.findById(legacy._id);
          assert.equal(verified.isVerified, true);
          assert.equal(verified.role, "owner");
          assert.equal(verified.verificationToken, undefined);
          assert.equal((await postJson(baseUrl, "/api/auth/verify-email", { token })).status, 400);
          assert.equal((await postJson(baseUrl, "/api/auth/resend-verification", { email: legacy.email })).status, 200);
          assert.equal(messages.length, 2);
        });
      });
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    User.prototype.getVerificationToken = originalVerificationToken;
    if (connected) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
