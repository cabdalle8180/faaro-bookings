import assert from "node:assert/strict";
import { test } from "node:test";
import { loginDestination } from "../src/auth/navigation.js";
import { paidBooking, paymentReturnTitle } from "../src/utils/booking.js";
import { request, setAccessToken, setUnauthorizedHandler } from "../src/api/client.js";
import { customerApi } from "../src/api/customer.js";

test("customer sign-in preserves checkout and Stripe return query parameters", () => {
  for (const path of ["/checkout?unitId=unit&startDate=2026-12-01&endDate=2026-12-03", "/payment/success?bookingId=booking", "/payment/cancel?bookingId=booking", "/customer/bookings/booking"]) {
    assert.equal(loginDestination("customer", path), path);
  }
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/admin/users", "/customer-other"]) {
    assert.equal(loginDestination("customer", path), "/customer");
  }
  assert.equal(loginDestination("owner", "/payment/success?bookingId=booking"), "/owner");
});

test("success return alone never displays a confirmed booking", () => {
  assert.equal(paymentReturnTitle({ status: "progress", isValid: false }, "success"), "Waiting for payment confirmation");
  assert.equal(paymentReturnTitle({ status: "expired" }, "success"), "Payment session expired");
  assert.equal(paymentReturnTitle({ status: "confirmed", isValid: true }, "success"), "Reservation confirmed");
  assert.equal(paidBooking({ status: "progress", isValid: true }), true);
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("concurrent authenticated calls share refresh and retry with the real returned token", async () => {
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  let retries = 0;
  setAccessToken("expired-test-token");
  globalThis.fetch = async (url, options) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({ success: true, accessToken: "refreshed-test-token" });
    }
    if (options.headers.Authorization === "Bearer refreshed-test-token") {
      retries++;
      return jsonResponse({ success: true, data: [] });
    }
    return jsonResponse({ success: false, message: "Expired" }, 401);
  };
  try {
    const results = await Promise.all([customerApi.units(), customerApi.businesses()]);
    assert.equal(refreshes, 1);
    assert.equal(retries, 2);
    assert.ok(results.every((result) => result.success));
  } finally { globalThis.fetch = originalFetch; setAccessToken(null); }
});

test("authentication failures clear the session; network failures preserve it and return errors", async () => {
  const originalFetch = globalThis.fetch;
  let cleared = 0;
  setUnauthorizedHandler(() => cleared++);
  globalThis.fetch = async () => jsonResponse({ success: false, message: "Expired" }, 401);
  try {
    await assert.rejects(customerApi.bookings(), (error) => error.status === 401);
    assert.equal(cleared, 1);
    globalThis.fetch = async () => { throw new TypeError("Network error"); };
    await assert.rejects(customerApi.bookings(), (error) => error.status === 0);
    assert.equal(cleared, 1);
  } finally { globalThis.fetch = originalFetch; setUnauthorizedHandler(null); }
});

test("booking API uses existing endpoint fields and handles non-JSON errors", async () => {
  const originalFetch = globalThis.fetch;
  const body = { unitId: "unit", businessId: "business", startDate: "2026-12-01", endDate: "2026-12-03" };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/customer/booking");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.deepEqual(JSON.parse(options.body), body);
    return new Response("Gateway unavailable", { status: 502 });
  };
  try { await assert.rejects(customerApi.createBooking(body), (error) => error.status === 502); }
  finally { globalThis.fetch = originalFetch; }
});
