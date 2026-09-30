import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Business from "../models/business.js";
import Unit from "../models/Unit.js";
import { getStripe } from "../config/stripe.js";
import { deleteImages } from "../utils/uploadImgs.js";
import cloudinary from "../config/cloudinary.js";

// Opt-in external-service smoke test. Never uses the application database, never
// charges a card, and removes only assets created by this isolated test run.
test("real Cloudinary upload/display/replacement and Stripe Checkout lifecycle", {
  skip: process.env.RUN_LIVE_SERVICE_TESTS !== "1" && "Opt in with RUN_LIVE_SERVICE_TESTS=1 and a local TEST_MONGODB_URI",
}, async (t) => {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri || !["127.0.0.1", "localhost"].includes(new URL(uri).hostname)) throw new Error("A local test database is required");
  const env = dotenv.parse(fs.readFileSync(new URL("../.env", import.meta.url)));
  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This test requires a Stripe test key");
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_KEY_SECRET"]) process.env[key] = env[key];
  process.env.ACCESS_TOKEN_SECRET = "isolated-live-services-access";
  process.env.REFRESH_TOKEN_SECRET = "isolated-live-services-refresh";
  process.env.CLIENT_URL = "http://127.0.0.1:5173";
  process.env.FRONTEND_URL = "http://127.0.0.1:5173";
  await mongoose.connect(uri, { dbName: `faaro_live_services_test_${process.pid}` });
  await Promise.all([User.init(), Business.init(), Unit.init(), Booking.init()]);
  const listener = await new Promise((resolve) => { const server = createApp().listen(0, "127.0.0.1", () => resolve(server)); });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const assets = [];
  const sessions = [];
  const api = async (path, token, options = {}) => {
    const response = await fetch(`${base}/api${path}`, { ...options, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(typeof options.body === "string" ? { "content-type": "application/json" } : {}),
    } });
    const body = await response.json();
    assert.ok(response.ok, `${path}: ${response.status} ${body.message || ""}`);
    return body;
  };
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4TQAAAAASUVORK5CYII=", "base64");
  const form = (fields, field = "images") => {
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, typeof value === "object" ? JSON.stringify(value) : value));
    body.append(field, new Blob([image], { type: "image/png" }), "isolated-service-test.png");
    return body;
  };
  const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  try {
    const password = "isolatedtestpassword";
    await User.create({ fullName: "Isolated service owner", email: `owner-${process.pid}@example.test`, phone: `live-owner-${process.pid}`, password, role: "owner", isVerified: true });
    await User.create({ fullName: "Isolated service customer", email: `customer-${process.pid}@example.test`, phone: `live-customer-${process.pid}`, password, role: "customer", isVerified: true });
    const owner = (await api("/auth/login", null, { method: "POST", body: JSON.stringify({ email: `owner-${process.pid}@example.test`, password }) })).accessToken;
    const customer = (await api("/auth/login", null, { method: "POST", body: JSON.stringify({ email: `customer-${process.pid}@example.test`, password }) })).accessToken;
    let business, unit;
    await t.test("owner creates and edits a Business with a real uploaded image", async () => {
      business = (await api("/owner/business", owner, { method: "POST", body: form({ name: "Isolated service business", category: "hotel", contactPhone: "test-phone", city: "Test city", address: "Test address", openHours: "24 hours" }) })).data;
      assets.push(...business.images);
      assert.equal(business.images.length, 1);
      assert.equal((await fetch(business.images[0].url)).status, 200);
      const updated = await api("/owner/business", owner, { method: "PATCH", body: JSON.stringify({ description: "Isolated integration test", retainedImageIds: business.images.map((item) => item.publicId) }) });
      assert.equal(updated.data.description, "Isolated integration test");
      assert.equal((await api(`/catalog/businesses/${business._id}`)).data.images[0].url, business.images[0].url);
    });
    await t.test("owner creates a draft Unit, replaces its image and publishes real data", async () => {
      unit = (await api("/owner/units", owner, { method: "POST", body: form({ code: "LIVE-SERVICE-TEST", title: "Isolated service unit", price: "20", active: "false", details: { hotel: { roomType: "suite", beds: 1, capacity: 2 } } }) })).data;
      assets.push(...unit.images);
      assert.equal((await api("/catalog/units")).data.length, 0);
      unit = (await api(`/owner/units/${unit._id}`, owner, { method: "PATCH", body: form({ retainedImageIds: [], price: "25", active: "true" }) })).data;
      assets.push(...unit.images);
      assert.equal(unit.images.length, 1);
      assert.equal((await fetch(unit.images[0].url)).status, 200);
      const published = (await api(`/catalog/units/${unit._id}`)).data;
      assert.equal(published.price, 25);
      assert.equal(published.images[0].url, unit.images[0].url);
    });
    await t.test("customer creates a real test Checkout with a private document, resumes and cancels it", async () => {
      const quote = (await api(`/customer/units/${unit._id}/availability?startDate=${future(3)}&endDate=${future(5)}&guests=2`, customer)).data;
      assert.equal(quote.totalAmount, 50);
      const response = await api("/customer/booking", customer, { method: "POST", body: form({ unitId: unit._id, businessId: business._id, startDate: future(3), endDate: future(5), guests: "2" }, "document") });
      const booking = await Booking.findById(response.data.id);
      assets.push(booking.document.toObject()); sessions.push(booking.stripeSessionId);
      const checkout = await getStripe().checkout.sessions.retrieve(booking.stripeSessionId);
      assert.equal(checkout.livemode, false); assert.equal(checkout.amount_total, 5000);
      assert.equal(checkout.metadata.bookingId, String(booking._id));
      assert.equal(checkout.currency, "usd"); assert.equal(checkout.payment_status, "unpaid");
      assert.ok(response.checkoutUrl.startsWith("https://checkout.stripe.com/"));
      assert.equal(booking.document.deliveryType, "authenticated");
      const privateUrl = cloudinary.utils.private_download_url(booking.document.publicId, booking.document.format,
        { resource_type: "image", type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 300 });
      assert.equal((await fetch(privateUrl)).status, 200);
      const unsignedUrl = `https://res.cloudinary.com/${env.CLOUD_NAME}/image/authenticated/${booking.document.publicId}.${booking.document.format}`;
      assert.ok([401, 403, 404].includes((await fetch(unsignedUrl)).status));
      const resume = (await api(`/customer/booking/${booking._id}?includeCheckout=true`, customer)).data;
      assert.equal(resume.checkout.state, "open"); assert.equal(resume.checkout.url, checkout.url);
      assert.equal((await api(`/customer/booking/${booking._id}/payment-status`, customer, { method: "POST" })).data.status, "progress");
      await api(`/customer/booking/${booking._id}/cancel`, customer, { method: "POST" });
      assert.equal((await getStripe().checkout.sessions.retrieve(booking.stripeSessionId)).status, "expired");
      assert.equal((await Booking.findById(booking._id)).status, "cancelled");
      await api(`/owner/units/${unit._id}`, owner, { method: "DELETE" });
      assert.equal((await api("/catalog/units")).data.length, 0);
    });
  } finally {
    // Include assets/session IDs even if an assertion failed after persistence.
    for (const doc of await Business.find()) assets.push(...doc.images);
    for (const doc of await Unit.find()) assets.push(...doc.images);
    for (const doc of await Booking.find()) {
      if (doc.document?.publicId) assets.push(doc.document.toObject());
      if (doc.stripeSessionId) sessions.push(doc.stripeSessionId);
    }
    for (const id of new Set(sessions)) {
      const session = await getStripe().checkout.sessions.retrieve(id);
      if (session.status === "open") await getStripe().checkout.sessions.expire(id);
    }
    await deleteImages([...new Map(assets.map((asset) => [asset.publicId, asset])).values()]);
    await new Promise((resolve) => listener.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
