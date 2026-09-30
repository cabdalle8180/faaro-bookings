import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerApi } from "../src/api/owner.js";

test("owner services use Business and Unit endpoints with real input fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    return new Response(JSON.stringify({ success: true, data: [] }), { headers: { "content-type": "application/json" } });
  };
  try {
    await ownerApi.business();
    await ownerApi.createBusiness({ name: "Submitted business name", category: "hotel", city: "Submitted city" });
    await ownerApi.updateBusiness({ contactPhone: "Submitted phone" });
    await ownerApi.unit("unit-id");
    await ownerApi.updateUnit("unit-id", { active: false });
    await ownerApi.updateUnit("unit-id", { active: true });
    assert.deepEqual(calls.map(({ url, method }) => ({ url, method })), [
      { url: "/api/owner/business", method: "GET" },
      { url: "/api/owner/business", method: "POST" },
      { url: "/api/owner/business", method: "PATCH" },
      { url: "/api/owner/units/unit-id", method: "GET" },
      { url: "/api/owner/units/unit-id", method: "PATCH" },
      { url: "/api/owner/units/unit-id", method: "PATCH" },
    ]);
    assert.equal(calls[4].body.active, false);
    assert.equal(calls[5].body.active, true);
    assert.ok(calls.every((call) => !call.url.includes("listing")));
  } finally { globalThis.fetch = originalFetch; }
});
