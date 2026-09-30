import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { getStripe } from "../config/stripe.js";
import { calculateBookingPrice } from "../services/booking.js";
import { reconcileBookingPayment } from "../services/booking.js";
import User from "../models/User.js";
import Business from "../models/business.js";
import Unit from "../models/Unit.js";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import Favorite from "../models/Favorite.js";

const futureDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test("backend imports, model rules, and server-side pricing", async () => {
  assert.equal(typeof createApp, "function");
  assert.ok(Favorite.schema.path("customerId"));
  assert.equal(Favorite.schema.path("customaId"), undefined);
  const id = new mongoose.Types.ObjectId();
  for (const stars of [1, 2, 3, 4, 5]) {
    await new Review({ customerId: id, businessId: id, unitId: id, stars }).validate();
  }
  for (const stars of [0, 6, -1, 5.5, "invalid"]) {
    await assert.rejects(new Review({ customerId: id, businessId: id, unitId: id, stars }).validate());
  }
  const price = calculateBookingPrice({ price: 125.25, currency: "USD" }, futureDate(3), futureDate(5));
  assert.equal(price.quantity, 2);
  assert.equal(price.amountMinor, 25050);
  assert.equal(price.totalAmount, 250.5);
  assert.throws(() => calculateBookingPrice({ price: 125, currency: "USD" }, futureDate(-1), futureDate(1)));
  assert.throws(() => calculateBookingPrice({ price: 1.005, currency: "USD" }, futureDate(3), futureDate(5)));
});

test("booking, ownership, catalog, signed payment and concurrent holds with local MongoDB", {
  skip: !process.env.TEST_MONGODB_URI && "Set TEST_MONGODB_URI to a local replica set",
}, async (t) => {
  const mongoUrl = new URL(process.env.TEST_MONGODB_URI);
  if (!["127.0.0.1", "localhost"].includes(mongoUrl.hostname)) {
    throw new Error("Integration tests only run against local MongoDB");
  }
  process.env.CLIENT_URL = "http://127.0.0.1:5173";
  process.env.FRONTEND_URL = "http://127.0.0.1:5173";
  process.env.ACCESS_TOKEN_SECRET = "integration-test-access-secret";
  process.env.REFRESH_TOKEN_SECRET = "integration-test-refresh-secret";
  process.env.STRIPE_SECRET_KEY = "sk_test_integration";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration_test";
  process.env.CLOUD_NAME = "integration-cloud";
  process.env.CLOUDINARY_API_KEY = "integration-key";
  process.env.CLOUDINARY_API_KEY_SECRET = "integration-secret";
  const dbName = `faaro_booking_test_${process.pid}`;
  await mongoose.connect(process.env.TEST_MONGODB_URI, { dbName });
  await Business.init();
  await Unit.init();
  const stripe = getStripe();
  const originalCreate = stripe.checkout.sessions.create;
  const originalRetrieve = stripe.checkout.sessions.retrieve;
  const originalExpire = stripe.checkout.sessions.expire;
  const sessions = new Map();
  const checkoutRequests = new Map();
  let nextSession = 0;
  stripe.checkout.sessions.create = async (params) => {
    const id = `cs_test_${++nextSession}`;
    const session = {
      id, object: "checkout.session", url: `https://checkout.stripe.test/${id}`, mode: "payment", status: "open",
      payment_status: "unpaid", amount_total: params.line_items[0].price_data.unit_amount,
      currency: params.line_items[0].price_data.currency, metadata: params.metadata,
      expires_at: params.expires_at,
    };
    sessions.set(id, session);
    checkoutRequests.set(id, params);
    return session;
  };
  stripe.checkout.sessions.retrieve = async (id) => sessions.get(id);
  stripe.checkout.sessions.expire = async (id) => {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown test session");
    session.status = "expired";
    return session;
  };
  const server = await new Promise((resolve) => {
    const listener = createApp().listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, roleToken, options = {}) => fetch(`${baseUrl}${path}`, {
    ...options, headers: { ...(roleToken ? { authorization: `Bearer ${roleToken}` } : {}),
      ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}),
      ...options.headers },
  });
  const tokenFor = (user) => jwt.sign({ id: user._id.toString(), version: 0 },
    process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
  const addUnit = (businessId, code, active = true, price = 125.25) => Unit.create({
    businessId, code, title: `Unit ${code}`, price, active,
    details: { hotel: { roomType: "suite", beds: 1, capacity: 2 } },
  });
  const book = (token, unit, business, start, end, extra = {}) => api("/api/customer/booking", token, {
    method: "POST", body: JSON.stringify({ unitId: unit._id, businessId: business._id,
      startDate: start, endDate: end, ...extra }),
  });
  const postStripeEvent = (type, checkout, eventId) => {
    const body = JSON.stringify({ id: eventId, type, data: { object: checkout } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body,
      secret: process.env.STRIPE_WEBHOOK_SECRET });
    return api("/api/stripe/webhook", null, { method: "POST", body,
      headers: { "stripe-signature": signature } });
  };
  try {
    const customer = await User.create({ fullName: "Audit Customer", email: `customer-${process.pid}@test.local`,
      phone: `100${process.pid}`, role: "customer", isVerified: true, password: "testpassword12" });
    const owner = await User.create({ fullName: "Audit Owner", email: `owner-${process.pid}@test.local`,
      phone: `200${process.pid}`, role: "owner", isVerified: true, password: "testpassword12" });
    const otherOwner = await User.create({ fullName: "Other Owner", email: `other-${process.pid}@test.local`,
      phone: `300${process.pid}`, role: "owner", isVerified: true, password: "testpassword12" });
    const otherCustomer = await User.create({ fullName: "Other Customer", email: `other-customer-${process.pid}@test.local`,
      phone: `400${process.pid}`, role: "customer", isVerified: true, password: "testpassword12" });
    let customerToken;
    const ownerToken = tokenFor(owner);
    const otherOwnerToken = tokenFor(otherOwner);
    const otherCustomerToken = tokenFor(otherCustomer);

    await t.test("existing customer signs in, refreshes, and accesses the real catalog routes", async () => {
      const response = await api("/api/auth/login", null, { method: "POST",
        body: JSON.stringify({ email: customer.email, password: "testpassword12" }) });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.data._id, customer._id.toString());
      assert.equal(payload.data.role, "customer");
      assert.equal(payload.data.password, undefined);
      customerToken = payload.accessToken;
      assert.equal(jwt.verify(customerToken, process.env.ACCESS_TOKEN_SECRET).id, customer._id.toString());
      const cookie = response.headers.get("set-cookie");
      assert.match(cookie, /HttpOnly/i);
      const refresh = await api("/api/auth/refresh", null, { method: "POST", headers: { cookie: cookie.split(";")[0] } });
      assert.equal(refresh.status, 200);
      assert.equal(jwt.verify((await refresh.json()).accessToken, process.env.ACCESS_TOKEN_SECRET).id, customer._id.toString());
      assert.equal((await api("/api/customer/units", customerToken)).status, 200);
      assert.equal((await api("/api/customer/units", "invalid-jwt")).status, 401);
      assert.equal((await api("/api/auth/login", null, { method: "POST",
        body: JSON.stringify({ email: customer.email, password: "incorrect-password" }) })).status, 401);
    });

    await t.test("owner authorization, mounted routes, and empty catalog", async () => {
      assert.equal((await api("/api/owner/booking")).status, 401);
      assert.equal((await api("/api/owner/booking", customerToken)).status, 403);
      assert.equal((await api("/api/customer/businesses", ownerToken)).status, 403);
      const businesses = await api("/api/customer/businesses", customerToken);
      assert.equal(businesses.status, 200);
      assert.deepEqual((await businesses.json()).data, []);
      const units = await api("/api/customer/units", customerToken);
      assert.equal(units.status, 200);
      assert.deepEqual((await units.json()).data, []);
    });

    const business = await Business.create({ ownerId: owner._id, name: "Audit Hotel", category: "hotel",
      contactPhone: "123", city: "Test City", address: "Test Road", openHours: "Always" });
    const suspendedBusiness = await Business.create({ ownerId: otherOwner._id, name: "Hidden Hotel",
      category: "hotel", contactPhone: "456", city: "Test City", address: "Test Road",
      openHours: "Always", status: "suspended" });
    const unit = await addUnit(business._id, "LIVE");
    const hiddenUnit = await addUnit(business._id, "HIDDEN", false);
    const suspendedUnit = await addUnit(suspendedBusiness._id, "SUSPENDED");
    await t.test("public catalog returns database records, filters real capacity/prices and protects private fields", async () => {
      const result = await api("/api/catalog/units?category=hotel&q=audit&min=100&max=150&guests=2");
      assert.equal(result.status, 200);
      const data = (await result.json()).data;
      assert.deepEqual(data.map((item) => item._id), [String(unit._id)]);
      assert.equal(data[0].bookingRevision, undefined);
      assert.equal(data[0].details.hotel.capacity, 2);
      const publicBusiness = (await (await api(`/api/catalog/businesses/${business._id}`)).json()).data;
      assert.equal(publicBusiness.name, business.name);
      assert.equal(publicBusiness.ownerId, undefined);
      assert.equal((await (await api("/api/catalog/units?guests=3")).json()).data.length, 0);
      assert.equal((await api("/api/catalog/units?min=invalid")).status, 400);
      assert.equal((await api("/api/catalog/units?min=200&max=20")).status, 400);
      assert.equal((await api("/api/catalog/units?guests=-1")).status, 400);
      assert.equal((await api(`/api/catalog/units/${hiddenUnit._id}`)).status, 404);
      assert.equal((await api(`/api/catalog/units/${suspendedUnit._id}`)).status, 404);
      assert.equal((await api(`/api/catalog/businesses/${suspendedBusiness._id}`)).status, 404);
      const quote = await api(`/api/catalog/units/${unit._id}/availability?startDate=${futureDate(3)}&endDate=${futureDate(5)}&guests=2`);
      assert.equal(quote.status, 200);
      assert.equal((await quote.json()).data.totalAmount, 250.5);
      assert.equal((await api(`/api/catalog/units/${unit._id}/availability?startDate=${futureDate(3)}&endDate=${futureDate(5)}&guests=3`)).status, 400);
      assert.equal((await api(`/api/catalog/units/${unit._id}/availability?startDate=${futureDate(3)}`)).status, 400);
      await User.updateOne({ _id: owner._id }, { $set: { status: "suspended" } });
      try {
        assert.equal((await api(`/api/catalog/units/${unit._id}`)).status, 404);
        assert.equal((await api(`/api/customer/units/${unit._id}`, customerToken)).status, 404);
        assert.equal((await book(customerToken, unit, business, futureDate(3), futureDate(5))).status, 409);
      } finally { await User.updateOne({ _id: owner._id }, { $set: { status: "active" } }); }
    });
    await t.test("catalog filters inactive businesses and units", async () => {
      const businesses = (await (await api("/api/customer/businesses", customerToken)).json()).data;
      assert.deepEqual(businesses.map((item) => item.name), ["Audit Hotel"]);
      const units = (await (await api("/api/customer/units", customerToken)).json()).data;
      assert.deepEqual(units.map((item) => item.code), ["LIVE"]);
      assert.equal((await api(`/api/customer/units/${hiddenUnit._id}`, customerToken)).status, 404);
      assert.equal((await api(`/api/customer/units/${suspendedUnit._id}`, customerToken)).status, 404);
      assert.equal((await api(`/api/customer/business/${suspendedBusiness._id}`, customerToken)).status, 404);
      const quote = await api(`/api/customer/units/${unit._id}/availability?startDate=${futureDate(3)}&endDate=${futureDate(5)}`,
        customerToken);
      assert.equal(quote.status, 200);
      assert.equal((await quote.json()).data.available, true);
    });

    await t.test("owner unit CRUD is restricted to the owned business", async () => {
      const ownedBusiness = (await (await api("/api/owner/business", ownerToken)).json()).data;
      assert.equal(ownedBusiness._id, business._id.toString());
      const response = await api("/api/owner/units", ownerToken, { method: "POST", body: JSON.stringify({
        code: "OWNER-CREATED", title: "Owner Suite", price: 50,
        details: { hotel: { roomType: "suite", beds: 1, capacity: 2 } },
      }) });
      assert.equal(response.status, 201);
      const created = (await response.json()).data;
      assert.equal(created.businessId, business._id.toString());
      assert.equal((await api(`/api/owner/units/${created._id}`, otherOwnerToken,
        { method: "PATCH", body: JSON.stringify({ price: 1 }) })).status, 403);
      const updated = await api(`/api/owner/units/${created._id}`, ownerToken,
        { method: "PATCH", body: JSON.stringify({ price: 75 }) });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).data.price, 75);
      assert.equal((await api(`/api/owner/units/${created._id}`, ownerToken,
        { method: "DELETE" })).status, 200);
      assert.equal((await Unit.findById(created._id)).active, false);
    });

    let firstBooking;
    await t.test("booking uses server price and snapshots it", async () => {
      const response = await book(customerToken, unit, business, futureDate(3), futureDate(5), { totalAmount: 1 });
      assert.equal(response.status, 201);
      const payload = await response.json();
      const stored = await Booking.findById(payload.data.id);
      assert.equal(stored.amountMinor, 25050);
      assert.equal(stored.totalAmount, 250.5);
      assert.equal(checkoutRequests.get(stored.stripeSessionId).line_items[0].price_data.unit_amount, stored.amountMinor);
      assert.match(checkoutRequests.get(stored.stripeSessionId).success_url,
        /^http:\/\/127\.0\.0\.1:5173\/payment\/success\?bookingId=/);
      assert.equal(new Date(payload.data.expiresAt).getTime(), stored.expiresAt.getTime());
    });
    await t.test("customer can resume their checkout without confirming from a browser return", async () => {
      const pending = await Booking.findOne({ unitId: unit._id, status: "progress" });
      const detail = await api(`/api/customer/booking/${pending._id}`, customerToken);
      assert.equal(detail.status, 200);
      const data = (await detail.json()).data;
      assert.equal(data.status, "progress");
      assert.equal(data.stripeSessionId, undefined);
      assert.equal(data.checkout, undefined);
      assert.equal((await Booking.findById(pending._id)).isValid, false);
      assert.equal((await api(`/api/customer/booking/${pending._id}?includeCheckout=true`, otherCustomerToken)).status, 404);
      const checkout = (await (await api(`/api/customer/booking/${pending._id}?includeCheckout=true`, customerToken)).json()).data.checkout;
      assert.equal(checkout.state, "open");
      assert.equal(checkout.url, sessions.get(pending.stripeSessionId).url);
      const session = sessions.get(pending.stripeSessionId);
      session.payment_status = "paid"; session.status = "complete";
      const waiting = (await (await api(`/api/customer/booking/${pending._id}?includeCheckout=true`, customerToken)).json()).data;
      assert.equal(waiting.checkout.state, "awaiting_confirmation");
      assert.equal(waiting.checkout.url, undefined);
      assert.equal(waiting.status, "progress");
      assert.equal((await Booking.findById(pending._id)).isValid, false);
      session.payment_status = "unpaid"; session.status = "open";
      const duplicate = await book(customerToken, unit, business, futureDate(3), futureDate(5));
      assert.equal(duplicate.status, 409);
      assert.match((await duplicate.json()).message, /resume payment/);
      assert.equal(await Booking.countDocuments({ unitId: unit._id }), 1);
    });
    await t.test("resume detects expired and mismatched Stripe sessions", async () => {
      const resumeUnit = await addUnit(business._id, "RESUME-EXPIRE");
      const payload = await (await book(customerToken, resumeUnit, business, futureDate(3), futureDate(5))).json();
      const booking = await Booking.findById(payload.data.id);
      const session = sessions.get(booking.stripeSessionId);
      session.metadata = { bookingId: new mongoose.Types.ObjectId().toString() };
      assert.equal((await api(`/api/customer/booking/${booking._id}?includeCheckout=true`, customerToken)).status, 409);
      session.metadata = { bookingId: booking._id.toString() }; session.status = "expired";
      const expired = (await (await api(`/api/customer/booking/${booking._id}?includeCheckout=true`, customerToken)).json()).data;
      assert.equal(expired.status, "expired");
      assert.equal(expired.checkout.url, undefined);
      assert.equal((await api(`/api/customer/units/${resumeUnit._id}/availability?startDate=${futureDate(3)}&endDate=${futureDate(5)}`, customerToken)).status, 200);
    });
    const paymentUnit = await addUnit(business._id, "PAYMENT");
    await t.test("signed webhook confirms once, invalid signature is rejected", async () => {
      const response = await book(customerToken, paymentUnit, business, futureDate(3), futureDate(5), { totalAmount: 1 });
      assert.equal(response.status, 201);
      const payload = await response.json();
      firstBooking = await Booking.findById(payload.data.id);
      assert.equal(firstBooking.status, "progress");
      assert.equal(firstBooking.isValid, false);
      assert.equal(firstBooking.amountMinor, 25050);
      assert.equal(firstBooking.totalAmount, 250.5);
      assert.equal(payload.checkoutUrl, sessions.get(firstBooking.stripeSessionId).url);
      const bad = await api("/api/stripe/webhook", null, {
        method: "POST", body: JSON.stringify({ id: "bad" }),
        headers: { "stripe-signature": "invalid" },
      });
      assert.equal(bad.status, 400);
      const checkout = sessions.get(firstBooking.stripeSessionId);
      checkout.payment_status = "paid";
      checkout.status = "complete";
      checkout.payment_intent = "pi_test_paid";
      const event = JSON.stringify({ id: "evt_test_paid", type: "checkout.session.completed",
        data: { object: checkout } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload: event,
        secret: process.env.STRIPE_WEBHOOK_SECRET });
      const postEvent = () => api("/api/stripe/webhook", null, { method: "POST", body: event,
        headers: { "stripe-signature": signature } });
      assert.equal((await postEvent()).status, 200);
      const confirmed = await Booking.findById(firstBooking._id);
      assert.equal(confirmed.status, "confirmed");
      assert.equal(confirmed.paymentStatus, "paid");
      assert.equal(confirmed.isValid, true);
      assert.equal(confirmed.stripePaymentIntentId, "pi_test_paid");
      assert.equal(confirmed.lastStripeEventId, "evt_test_paid");
      assert.equal((await postEvent()).status, 200);
      const duplicate = await Booking.findById(firstBooking._id);
      assert.equal(duplicate.confirmedAt.getTime(), confirmed.confirmedAt.getTime());
      const repeated = await Promise.all([postEvent(), postEvent(),
        postStripeEvent("checkout.session.async_payment_succeeded", checkout, "evt_paid_again")]);
      assert.ok(repeated.every((response) => response.status === 200));
      const replayed = await Booking.findById(firstBooking._id);
      assert.equal(replayed.confirmedAt.getTime(), confirmed.confirmedAt.getTime());
      assert.equal(replayed.lastStripeEventId, "evt_test_paid");
      assert.equal(replayed.paymentStatus, "paid");
      assert.equal(await Booking.countDocuments({ stripeSessionId: firstBooking.stripeSessionId }), 1);
      const unavailable = await api(`/api/customer/units/${paymentUnit._id}/availability?startDate=${futureDate(3)}&endDate=${futureDate(5)}`,
        customerToken);
      assert.equal((await unavailable.json()).data.available, false);
    });

    await t.test("owner cannot read another business booking", async () => {
      suspendedBusiness.status = "active";
      await suspendedBusiness.save();
      assert.equal((await api(`/api/owner/booking/${firstBooking._id}`, ownerToken)).status, 200);
      assert.equal((await api(`/api/owner/booking/${firstBooking._id}`, otherOwnerToken)).status, 404);
      const ownerUnits = (await (await api("/api/owner/units", ownerToken)).json()).data;
      const otherUnits = (await (await api("/api/owner/units", otherOwnerToken)).json()).data;
      assert.ok(ownerUnits.some((item) => item._id === unit._id.toString()));
      assert.ok(otherUnits.every((item) => item._id !== unit._id.toString()));
      assert.equal((await api(`/api/owner/units/${unit._id}`, otherOwnerToken,
        { method: "DELETE" })).status, 404);
      assert.equal((await api(`/api/owner/units/${unit._id}`, otherOwnerToken,
        { method: "PATCH", body: JSON.stringify({ price: 1 }) })).status, 404);
      const customerList = (await (await api("/api/customer/bookings", customerToken)).json()).data;
      assert.ok(customerList.some((item) => item._id === firstBooking._id.toString()));
      const customerDetail = (await (await api(`/api/customer/booking/${firstBooking._id}`,
        customerToken)).json()).data;
      assert.equal(customerDetail.totalAmount, 250.5);
      assert.equal(customerDetail.status, "confirmed");
      paymentUnit.price = 999;
      await paymentUnit.save();
      const historical = (await (await api(`/api/owner/booking/${firstBooking._id}`, ownerToken)).json()).data;
      assert.equal(historical.totalAmount, 250.5);
      await Booking.updateOne({ _id: firstBooking._id }, { $set: {
        document: { publicId: "private-test-document", format: "jpg", deliveryType: "authenticated" },
      } });
      const withDocument = (await (await api(`/api/owner/booking/${firstBooking._id}`, ownerToken)).json()).data;
      assert.equal(withDocument.document, undefined);
      assert.match(withDocument.documentAccessUrl, /private-test-document/);
      assert.equal((await api(`/api/customer/booking/${firstBooking._id}`, otherCustomerToken)).status, 404);
    });

    await t.test("signed amount mismatch never confirms a booking", async () => {
      const mismatchUnit = await addUnit(business._id, "MISMATCH");
      const response = await book(customerToken, mismatchUnit, business, futureDate(3), futureDate(5));
      assert.equal(response.status, 201);
      const payload = await response.json();
      const stored = await Booking.findById(payload.data.id);
      const checkout = { ...sessions.get(stored.stripeSessionId), payment_status: "paid",
        status: "complete", amount_total: stored.amountMinor - 1 };
      const event = JSON.stringify({ id: "evt_bad_amount", type: "checkout.session.completed",
        data: { object: checkout } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload: event,
        secret: process.env.STRIPE_WEBHOOK_SECRET });
      const webhook = await api("/api/stripe/webhook", null, { method: "POST", body: event,
        headers: { "stripe-signature": signature } });
      assert.equal(webhook.status, 409);
      assert.equal((await Booking.findById(stored._id)).status, "progress");
    });

    await t.test("signed wrong currency never confirms a booking", async () => {
      const currencyUnit = await addUnit(business._id, "CURRENCY");
      const response = await book(customerToken, currencyUnit, business, futureDate(3), futureDate(5));
      assert.equal(response.status, 201);
      const stored = await Booking.findById((await response.json()).data.id);
      const checkout = { ...sessions.get(stored.stripeSessionId), payment_status: "paid",
        status: "complete", currency: "eur" };
      assert.equal((await postStripeEvent("checkout.session.completed", checkout, "evt_wrong_currency")).status, 409);
      const unchanged = await Booking.findById(stored._id);
      assert.equal(unchanged.status, "progress");
      assert.equal(unchanged.paymentStatus, "unpaid");
      assert.equal(unchanged.isValid, false);
      assert.equal(unchanged.confirmedAt, undefined);
      assert.equal(unchanged.lastStripeEventId, undefined);
    });

    await t.test("signed wrong metadata and session references cannot confirm either booking", async () => {
      const referenceUnit = await addUnit(business._id, "REFERENCE");
      const response = await book(customerToken, referenceUnit, business, futureDate(3), futureDate(5));
      const otherResponse = await book(otherCustomerToken, referenceUnit, business, futureDate(6), futureDate(8));
      assert.equal(response.status, 201); assert.equal(otherResponse.status, 201);
      const stored = await Booking.findById((await response.json()).data.id);
      const other = await Booking.findById((await otherResponse.json()).data.id);
      const checkout = { ...sessions.get(stored.stripeSessionId), status: "complete", payment_status: "paid" };
      const invalidReferences = [
        { ...checkout, metadata: {} },
        { ...checkout, metadata: { bookingId: "not-an-object-id" } },
        { ...checkout, metadata: { bookingId: new mongoose.Types.ObjectId().toString() } },
        { ...checkout, metadata: { bookingId: other._id.toString() } },
        { ...checkout, id: other.stripeSessionId },
      ];
      for (const [index, invalid] of invalidReferences.entries()) {
        assert.equal((await postStripeEvent("checkout.session.completed", invalid, `evt_reference_${index}`)).status, 200);
      }
      for (const id of [stored._id, other._id]) {
        const unchanged = await Booking.findById(id);
        assert.equal(unchanged.status, "progress");
        assert.equal(unchanged.paymentStatus, "unpaid");
        assert.equal(unchanged.isValid, false);
        assert.equal(unchanged.confirmedAt, undefined);
      }
    });

    await t.test("missing, incorrect, expired and tampered signatures cannot confirm payment", async () => {
      const signatureUnit = await addUnit(business._id, "SIGNATURE");
      const response = await book(customerToken, signatureUnit, business, futureDate(3), futureDate(5));
      assert.equal(response.status, 201);
      const stored = await Booking.findById((await response.json()).data.id);
      const checkout = { ...sessions.get(stored.stripeSessionId), status: "complete", payment_status: "paid" };
      const body = JSON.stringify({ id: "evt_signature", type: "checkout.session.completed", data: { object: checkout } });
      const valid = stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET });
      const wrong = stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_wrong_test_endpoint" });
      const expired = stripe.webhooks.generateTestHeaderString({ payload: body,
        secret: process.env.STRIPE_WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 600 });
      for (const signature of [undefined, "invalid", wrong, expired]) {
        const result = await api("/api/stripe/webhook", null, { method: "POST", body,
          headers: signature ? { "stripe-signature": signature } : {} });
        assert.equal(result.status, 400);
      }
      assert.equal((await api("/api/stripe/webhook", null, { method: "POST", body: body + " ",
        headers: { "stripe-signature": valid } })).status, 400);
      const unchanged = await Booking.findById(stored._id);
      assert.equal(unchanged.status, "progress");
      assert.equal(unchanged.paymentStatus, "unpaid");
      assert.equal(unchanged.isValid, false);
    });

    await t.test("unrelated, unpaid and incomplete Checkout events never confirm payment", async () => {
      const ignoredUnit = await addUnit(business._id, "IGNORED-EVENT");
      const response = await book(customerToken, ignoredUnit, business, futureDate(3), futureDate(5));
      assert.equal(response.status, 201);
      const stored = await Booking.findById((await response.json()).data.id);
      const checkout = { ...sessions.get(stored.stripeSessionId), status: "complete", payment_status: "paid" };
      assert.equal((await postStripeEvent("payment_intent.succeeded", checkout, "evt_unrelated")).status, 200);
      assert.equal((await postStripeEvent("checkout.session.completed", { ...checkout, object: "payment_intent" }, "evt_wrong_object")).status, 200);
      assert.equal((await postStripeEvent("checkout.session.completed", { ...checkout, mode: "subscription" }, "evt_wrong_mode")).status, 200);
      assert.equal((await postStripeEvent("checkout.session.completed", { ...checkout, payment_status: "unpaid" }, "evt_not_paid")).status, 200);
      assert.equal((await postStripeEvent("checkout.session.completed", { ...checkout, status: "open" }, "evt_not_complete")).status, 409);
      const unchanged = await Booking.findById(stored._id);
      assert.equal(unchanged.status, "progress");
      assert.equal(unchanged.paymentStatus, "unpaid");
      assert.equal(unchanged.isValid, false);
      assert.equal(unchanged.confirmedAt, undefined);
    });

    await t.test("delayed payment stays pending until its signed async success event", async () => {
      const asyncUnit = await addUnit(business._id, "ASYNC-PAYMENT");
      const response = await book(customerToken, asyncUnit, business, futureDate(3), futureDate(5));
      assert.equal(response.status, 201);
      const stored = await Booking.findById((await response.json()).data.id);
      const checkout = sessions.get(stored.stripeSessionId);
      checkout.status = "complete";
      assert.equal((await postStripeEvent("checkout.session.completed", checkout, "evt_async_started")).status, 200);
      assert.equal((await Booking.findById(stored._id)).paymentStatus, "unpaid");
      checkout.payment_status = "paid"; checkout.payment_intent = "pi_async_paid";
      assert.equal((await postStripeEvent("checkout.session.async_payment_succeeded", checkout, "evt_async_paid")).status, 200);
      const confirmed = await Booking.findById(stored._id);
      assert.equal(confirmed.status, "confirmed");
      assert.equal(confirmed.paymentStatus, "paid");
      assert.equal(confirmed.isValid, true);
      assert.equal(confirmed.stripePaymentIntentId, "pi_async_paid");
      assert.equal(confirmed.lastStripeEventId, "evt_async_paid");
      assert.equal((await postStripeEvent("checkout.session.async_payment_failed", { ...checkout, payment_status: "unpaid" }, "evt_late_failure")).status, 200);
      assert.equal((await postStripeEvent("checkout.session.expired", { ...checkout, status: "expired", payment_status: "unpaid" }, "evt_late_expiry")).status, 200);
      const afterLateEvents = await Booking.findById(stored._id);
      assert.equal(afterLateEvents.status, "confirmed");
      assert.equal(afterLateEvents.paymentStatus, "paid");
      assert.equal(afterLateEvents.confirmedAt.getTime(), confirmed.confirmedAt.getTime());
    });

    await t.test("failed, expired and cancelled bookings cannot be confirmed by a late success event", async () => {
      for (const [index, state] of ["failed", "expired", "cancelled"].entries()) {
        const terminalUnit = await addUnit(business._id, `TERMINAL-${state}`);
        const response = await book(customerToken, terminalUnit, business, futureDate(3), futureDate(5));
        assert.equal(response.status, 201);
        const stored = await Booking.findById((await response.json()).data.id);
        const checkout = sessions.get(stored.stripeSessionId);
        if (state === "cancelled") {
          assert.equal((await api(`/api/customer/booking/${stored._id}/cancel`, customerToken, { method: "POST" })).status, 200);
        } else {
          checkout.status = state === "expired" ? "expired" : "complete";
          const type = state === "failed" ? "checkout.session.async_payment_failed" : "checkout.session.expired";
          assert.equal((await postStripeEvent(type, checkout, `evt_terminal_${index}`)).status, 200);
        }
        const before = await Booking.findById(stored._id);
        assert.equal(before.status, state === "cancelled" ? "cancelled" : "expired");
        assert.equal(before.paymentStatus, state === "failed" ? "failed" : "expired");
        const latePaid = { ...checkout, status: "complete", payment_status: "paid" };
        assert.equal((await postStripeEvent("checkout.session.completed", latePaid, `evt_late_success_${index}`)).status, 200);
        const after = await Booking.findById(stored._id);
        assert.equal(after.status, before.status);
        assert.equal(after.paymentStatus, before.paymentStatus);
        assert.equal(after.isValid, false);
        assert.equal(after.confirmedAt, undefined);
      }
    });

    await t.test("paid retrieval, cancellation and overdue reconciliation never replace the signed webhook", async () => {
      const webhookOnlyUnit = await addUnit(business._id, "WEBHOOK-ONLY");
      const response = await book(customerToken, webhookOnlyUnit, business, futureDate(3), futureDate(5));
      assert.equal(response.status, 201);
      const stored = await Booking.findById((await response.json()).data.id);
      const checkout = sessions.get(stored.stripeSessionId);
      checkout.status = "complete"; checkout.payment_status = "paid";
      await Booking.updateOne({ _id: stored._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const detail = await api(`/api/customer/booking/${stored._id}?includeCheckout=true`, customerToken);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).data.checkout.state, "awaiting_confirmation");
      assert.equal((await api(`/api/customer/booking/${stored._id}/cancel`, customerToken, { method: "POST" })).status, 409);
      const availability = await api(`/api/customer/units/${webhookOnlyUnit._id}/availability?startDate=${futureDate(3)}&endDate=${futureDate(5)}`, customerToken);
      assert.equal(availability.status, 200);
      assert.equal((await availability.json()).data.available, false);
      assert.equal((await book(otherCustomerToken, webhookOnlyUnit, business, futureDate(3), futureDate(5))).status, 409);
      const stillPending = await Booking.findById(stored._id);
      assert.equal(stillPending.status, "progress");
      assert.equal(stillPending.paymentStatus, "unpaid");
      assert.equal(stillPending.isValid, false);
      assert.equal(stillPending.confirmedAt, undefined);
      assert.equal(stillPending.lastStripeEventId, undefined);
      assert.equal((await postStripeEvent("checkout.session.completed", checkout, "evt_webhook_only")).status, 200);
      const confirmed = await Booking.findById(stored._id);
      assert.equal(confirmed.status, "confirmed");
      assert.equal(confirmed.paymentStatus, "paid");
      assert.equal(confirmed.isValid, true);
    });

    await t.test("signed expiration releases hold without confirming payment", async () => {
      const expiringUnit = await addUnit(business._id, "WEBHOOK-EXPIRE");
      const response = await book(customerToken, expiringUnit, business, futureDate(6), futureDate(8));
      assert.equal(response.status, 201);
      const payload = await response.json();
      const stored = await Booking.findById(payload.data.id);
      const checkout = { ...sessions.get(stored.stripeSessionId), status: "expired" };
      const event = JSON.stringify({ id: "evt_expired", type: "checkout.session.expired",
        data: { object: checkout } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload: event,
        secret: process.env.STRIPE_WEBHOOK_SECRET });
      assert.equal((await api("/api/stripe/webhook", null, { method: "POST", body: event,
        headers: { "stripe-signature": signature } })).status, 200);
      assert.equal((await Booking.findById(stored._id)).status, "expired");
      assert.equal((await book(customerToken, expiringUnit, business, futureDate(6), futureDate(8))).status, 201);
    });

    await t.test("customer cancellation releases only their own unpaid hold", async () => {
      const cancelUnit = await addUnit(business._id, "CANCEL-PENDING");
      const response = await book(customerToken, cancelUnit, business, futureDate(15), futureDate(17));
      assert.equal(response.status, 201);
      const payload = await response.json();
      assert.equal((await api(`/api/customer/booking/${payload.data.id}/cancel`, otherCustomerToken,
        { method: "POST" })).status, 404);
      assert.equal((await api(`/api/customer/booking/${payload.data.id}/cancel`, customerToken,
        { method: "POST" })).status, 200);
      assert.equal((await Booking.findById(payload.data.id)).status, "cancelled");
      assert.equal((await book(customerToken, cancelUnit, business, futureDate(15), futureDate(17))).status, 201);
      assert.equal((await api(`/api/customer/booking/${firstBooking._id}/cancel`, customerToken,
        { method: "POST" })).status, 409);
    });

    await t.test("Checkout creation failure releases the unpaid hold", async () => {
      const failureUnit = await addUnit(business._id, "CHECKOUT-FAIL");
      stripe.checkout.sessions.create = async () => { throw new Error("Stripe test failure"); };
      try {
        assert.equal((await book(customerToken, failureUnit, business, futureDate(9), futureDate(11))).status, 500);
        assert.equal(await Booking.countDocuments({ unitId: failureUnit._id, status: "progress" }), 0);
      } finally {
        stripe.checkout.sessions.create = async (params) => {
          const id = `cs_test_${++nextSession}`;
          const session = { id, object: "checkout.session", url: `https://checkout.stripe.test/${id}`, mode: "payment",
            status: "open", payment_status: "unpaid",
            amount_total: params.line_items[0].price_data.unit_amount,
            currency: params.line_items[0].price_data.currency, metadata: params.metadata,
            expires_at: params.expires_at };
          sessions.set(id, session);
          checkoutRequests.set(id, params);
          return session;
        };
      }
      assert.equal((await book(customerToken, failureUnit, business, futureDate(9), futureDate(11))).status, 201);
    });

    await t.test("expired unpaid hold releases availability", async () => {
      const expiringUnit = await addUnit(business._id, "EXPIRING");
      const old = await Booking.create({ unitId: expiringUnit._id, businessId: business._id,
        customerId: customer._id, code: "expired-hold", startDate: futureDate(8), endDate: futureDate(10),
        status: "progress", isValid: false, expiresAt: new Date(Date.now() - 1000) });
      const response = await book(customerToken, expiringUnit, business, futureDate(8), futureDate(10));
      assert.equal(response.status, 201);
      assert.equal((await Booking.findById(old._id)).status, "expired");
    });

    await t.test("concurrent attempts do not both reserve the same unit", async () => {
      const concurrentUnit = await addUnit(business._id, "CONCURRENT");
      const results = await Promise.all([
        book(customerToken, concurrentUnit, business, futureDate(12), futureDate(14)),
        book(customerToken, concurrentUnit, business, futureDate(12), futureDate(14)),
      ]);
      assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
      assert.equal(await Booking.countDocuments({ unitId: concurrentUnit._id, status: "progress" }), 1);
    });

    await t.test("owner business creation is authenticated, unique, and cannot change ownership/status", async () => {
      const newOwner = await User.create({ fullName: "Business Test Owner", email: `business-owner-${process.pid}@test.local`,
        phone: `500${process.pid}`, role: "owner", isVerified: true, password: "testpassword12" });
      const newOwnerToken = tokenFor(newOwner);
      const body = { name: "Owner Flow Business", category: "hotel", contactPhone: "555", city: "Test City", address: "Test Address", openHours: "24 hours" };
      assert.equal((await api("/api/owner/business", null, { method: "POST", body: JSON.stringify(body) })).status, 401);
      assert.equal((await api("/api/owner/business", customerToken, { method: "POST", body: JSON.stringify(body) })).status, 403);
      assert.equal((await api("/api/owner/business", newOwnerToken)).status, 404);
      assert.equal((await api("/api/owner/business", newOwnerToken, { method: "POST", body: JSON.stringify({ ...body, ownerId: owner._id }) })).status, 403);
      const concurrent = await Promise.all([0, 1].map(() => api("/api/owner/business", newOwnerToken,
        { method: "POST", body: JSON.stringify(body) })));
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await Business.countDocuments({ ownerId: newOwner._id }), 1);
      const updated = await api("/api/owner/business", newOwnerToken, { method: "PATCH", body: JSON.stringify({ city: "Updated City" }) });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).data.city, "Updated City");
      assert.equal((await api("/api/owner/business", newOwnerToken, { method: "PATCH", body: JSON.stringify({ ownerId: owner._id }) })).status, 403);
      assert.equal((await api("/api/owner/business", newOwnerToken, { method: "PATCH", body: JSON.stringify({ status: "active" }) })).status, 403);
      assert.equal((await api("/api/owner/business", newOwnerToken, { method: "PATCH", body: JSON.stringify({ category: "car_rental" }) })).status, 409);
      assert.equal((await Business.findOne({ ownerId: owner._id })).city, "Test City");
    });

    await t.test("owner Business → Unit → Publish → customer booking → signed Stripe confirmation", async () => {
      const pipelineOwner = await User.create({ fullName: "Pipeline Test Owner", email: `pipeline-owner-${process.pid}@test.local`,
        phone: `600${process.pid}`, role: "owner", isVerified: true, password: "testpassword12" });
      const login = await api("/api/auth/login", null, { method: "POST", body: JSON.stringify({ email: pipelineOwner.email, password: "testpassword12" }) });
      assert.equal(login.status, 200);
      const pipelineToken = (await login.json()).accessToken;
      const createdBusiness = await api("/api/owner/business", pipelineToken, { method: "POST", body: JSON.stringify({
        name: "Pipeline Test Business", category: "hotel", contactPhone: "600", city: "Test City", address: "Test Address", openHours: "24 hours" }) });
      assert.equal(createdBusiness.status, 201);
      const businessData = (await createdBusiness.json()).data;
      assert.equal(businessData.ownerId, pipelineOwner._id.toString());
      const createdUnit = await api("/api/owner/units", pipelineToken, { method: "POST", body: JSON.stringify({
        code: "PIPELINE", title: "Pipeline Test Unit", price: 85.75, active: false,
        details: { hotel: { roomType: "suite", beds: 1, capacity: 2 } } }) });
      assert.equal(createdUnit.status, 201);
      const unitData = (await createdUnit.json()).data;
      assert.equal(unitData.businessId, businessData._id);
      assert.equal(unitData.active, false);
      assert.equal((await api(`/api/customer/units/${unitData._id}`, customerToken)).status, 404);
      assert.equal((await api(`/api/owner/units/${unitData._id}`, otherOwnerToken)).status, 404);
      const publish = await api(`/api/owner/units/${unitData._id}`, pipelineToken, { method: "PATCH", body: JSON.stringify({ active: true }) });
      assert.equal(publish.status, 200);
      const catalog = (await (await api("/api/customer/units", customerToken)).json()).data;
      assert.ok(catalog.some((item) => item._id === unitData._id));
      const detail = await api(`/api/customer/units/${unitData._id}`, customerToken);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).data.title, unitData.title);
      const quote = await api(`/api/customer/units/${unitData._id}/availability?startDate=${futureDate(20)}&endDate=${futureDate(22)}`, customerToken);
      assert.equal(quote.status, 200);
      assert.equal((await quote.json()).data.totalAmount, 171.5);
      const booked = await book(customerToken, { _id: unitData._id }, { _id: businessData._id }, futureDate(20), futureDate(22), { totalAmount: 0.01 });
      assert.equal(booked.status, 201);
      const result = await booked.json();
      const stored = await Booking.findById(result.data.id);
      assert.equal(stored.status, "progress");
      assert.equal(stored.totalAmount, 171.5);
      assert.equal((await api(`/api/customer/booking/${stored._id}`, customerToken)).status, 200);
      assert.equal((await Booking.findById(stored._id)).status, "progress");
      const checkout = sessions.get(stored.stripeSessionId);
      checkout.status = "complete"; checkout.payment_status = "paid"; checkout.payment_intent = "pi_pipeline";
      const event = JSON.stringify({ id: "evt_pipeline", type: "checkout.session.completed", data: { object: checkout } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload: event, secret: process.env.STRIPE_WEBHOOK_SECRET });
      assert.equal((await api("/api/stripe/webhook", null, { method: "POST", body: event, headers: { "stripe-signature": signature } })).status, 200);
      const confirmed = (await (await api(`/api/customer/booking/${stored._id}`, customerToken)).json()).data;
      assert.equal(confirmed.status, "confirmed");
      assert.equal(confirmed.paymentStatus, "paid");
      assert.ok((await (await api("/api/owner/booking", pipelineToken)).json()).data.some((item) => item._id === stored._id.toString()));
      assert.equal((await api(`/api/owner/units/${unitData._id}`, pipelineToken, { method: "PATCH", body: JSON.stringify({ active: false }) })).status, 200);
      assert.equal((await api(`/api/customer/units/${unitData._id}`, customerToken)).status, 404);
      assert.equal((await Booking.findById(stored._id)).status, "confirmed");
      await Business.updateOne({ _id: businessData._id }, { $set: { status: "suspended" } });
      assert.equal((await api(`/api/owner/units/${unitData._id}`, pipelineToken, { method: "PATCH", body: JSON.stringify({ active: true }) })).status, 403);
      assert.equal((await api("/api/owner/business", pipelineToken, { method: "PATCH", body: JSON.stringify({ name: "Change suspended" }) })).status, 403);
      assert.equal((await mongoose.connection.db.listCollections({ name: "listings" }).toArray()).length, 0);
    });

    await t.test("unit publishing and detail validation reject invalid values", async () => {
      assert.equal((await api(`/api/owner/units/${unit._id}`, ownerToken, { method: "PATCH", body: JSON.stringify({ active: "not-a-boolean" }) })).status, 400);
      assert.equal((await api(`/api/owner/units/${unit._id}`, ownerToken, { method: "PATCH", body: JSON.stringify({ details: { hotel: { beds: 1.5 } } }) })).status, 400);
      const upload = new FormData(); upload.append("images", new Blob(["text"], { type: "text/plain" }), "wrong.txt");
      assert.equal((await api(`/api/owner/units/${unit._id}`, ownerToken, { method: "PATCH", body: upload })).status, 400);
      assert.equal((await api(`/api/owner/units/${unit._id}`, ownerToken, { method: "PATCH", body: JSON.stringify({ retainedImageIds: ["another-owner-image"] }) })).status, 400);
      assert.equal((await api("/api/owner/business", ownerToken, { method: "PATCH", body: JSON.stringify({ retainedImageIds: ["another-owner-image"] }) })).status, 400);
    });

    await t.test("payment recovery uses Stripe's stored session, checks ownership and remains idempotent with webhooks", async () => {
      const response = await book(customerToken, unit, business, futureDate(200), futureDate(202), { guests: 2 });
      assert.equal(response.status, 201);
      const saved = await Booking.findById((await response.json()).data.id);
      assert.equal(saved.guests, 2);
      const route = `/api/customer/booking/${saved._id}/payment-status`;
      assert.equal((await api(route, null, { method: "POST" })).status, 401);
      assert.equal((await api(route, ownerToken, { method: "POST" })).status, 403);
      assert.equal((await api(route, otherCustomerToken, { method: "POST" })).status, 404);
      const pending = await api(route, customerToken, { method: "POST", body: JSON.stringify({ payment_status: "paid", status: "confirmed" }) });
      assert.equal((await pending.json()).data.status, "progress");
      const checkout = sessions.get(saved.stripeSessionId);
      checkout.status = "complete"; checkout.payment_status = "paid"; checkout.payment_intent = "pi_recovery";
      checkout.amount_total++;
      assert.equal((await api(route, customerToken, { method: "POST" })).status, 409);
      assert.equal((await Booking.findById(saved._id)).status, "progress");
      checkout.amount_total--;
      const paid = await api(route, customerToken, { method: "POST" });
      assert.equal(paid.status, 200);
      const data = (await paid.json()).data;
      assert.equal(data.status, "confirmed"); assert.equal(data.paymentStatus, "paid");
      assert.equal(data.stripeSessionId, undefined); assert.equal(data.customerId, undefined);
      const timestamp = data.confirmedAt;
      assert.equal((await (await api(route, customerToken, { method: "POST" })).json()).data.confirmedAt, timestamp);
      assert.equal((await postStripeEvent("checkout.session.completed", checkout, "evt_recovery_duplicate")).status, 200);
      assert.equal((await Booking.findById(saved._id)).confirmedAt.toISOString(), timestamp);
      assert.ok((await (await api("/api/owner/booking", ownerToken)).json()).data.some((item) => item._id === String(saved._id)));
      assert.equal((await api(`/api/owner/check-booking/${saved._id}`, ownerToken, { method: "POST", body: JSON.stringify({ booking_code: saved.code }) })).status, 200);
      assert.equal((await (await api(`/api/catalog/units?startDate=${futureDate(201)}&endDate=${futureDate(202)}`)).json()).data.some((item) => item._id === String(unit._id)), false);
    });

    await t.test("background reconciliation recovers a missed payment without a browser return", async () => {
      const response = await book(customerToken, unit, business, futureDate(210), futureDate(211));
      const booking = await Booking.findById((await response.json()).data.id);
      const checkout = sessions.get(booking.stripeSessionId);
      checkout.status = "complete"; checkout.payment_status = "paid";
      await reconcileBookingPayment(booking, stripe);
      assert.equal((await Booking.findById(booking._id)).paymentStatus, "paid");
      assert.equal((await book(customerToken, unit, business, futureDate(220), futureDate(221), { guests: 3 })).status, 400);
    });
  } finally {
    server.close();
    stripe.checkout.sessions.create = originalCreate;
    stripe.checkout.sessions.retrieve = originalRetrieve;
    stripe.checkout.sessions.expire = originalExpire;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
