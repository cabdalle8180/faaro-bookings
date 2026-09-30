# Customer and owner booking flow verification

Verified on 2026-09-30. Existing changes were preserved. No Listing model,
backend Listing route/controller/collection, or application sample records were
created. Admin screens were not changed.

## Implemented

- Owner dashboard, Business creation/profile editing, Unit inventory, Unit
  creation/editing, save unpublished, publish, and unpublish.
- Owner forms use Business.js and Unit.js fields, including category-specific
  hotel, vehicle, and apartment specifications and actual image uploads.
- Business ownership comes from the authenticated owner. A unique owner index
  prevents duplicate businesses. Owners cannot transfer ownership, change
  suspension status, or modify another owner's units.
- Published units of active businesses feed the customer catalog and signed-in
  search. Category, text, and price filters operate on real API results.
- Unit detail/specifications, date availability, server quote, booking creation,
  Stripe redirect, success/cancel returns, My bookings, and booking detail.
- Login preserves checkout/return query parameters. API requests share token
  refresh and handle unauthorized/network/error responses.
- Customers can resume their own existing open Checkout Session or cancel an
  unpaid hold. Reading the return/resume page does not confirm payment.
- Confirmed legacy bookings remain readable without inventing historical prices.

## Connected endpoints

Authentication retains the existing `/api/auth/login`, `/refresh`, `/logout`,
`/register`, `/verify-email`, `/resend-verification`, `/forgot-password`, and
`/reset-password` endpoints.

Owner endpoints under `/api/owner`:

- `GET`, `POST`, `PATCH /business`
- `GET`, `POST /units`
- `GET`, `PATCH`, `DELETE /units/:id` (DELETE deactivates)
- Existing `GET /booking`, `GET /booking/:id`, `POST /check-booking/:id`

Customer endpoints under `/api/customer`:

- `GET /businesses`, `GET /business/:id`
- `GET /units`, `GET /units/:id`
- `GET /units/:id/availability?startDate=...&endDate=...`
- `POST /booking`, `GET /bookings`, `GET /booking/:id`
- `GET /booking/:id?includeCheckout=true` for authenticated checkout recovery
- `POST /booking/:id/cancel` for unpaid holds

Payment confirmation uses `POST /api/stripe/webhook`, with the raw request body
and Stripe signature verification. Charged amounts are calculated on the server
and stored on the booking. Browser redirects do not confirm a pending booking.

## Tests and observed runtime

- Backend: **26 passed, 0 failed, 0 skipped**, using a local MongoDB replica set.
- Frontend: **6 passed, 0 failed**.
- Frontend production build: **passed**.
- Full API integration test: owner login → Business creation → unpublished Unit
  creation → publish → customer catalog/detail → quote → pending booking → signed
  Stripe webhook → confirmed customer and owner booking → unpublish. Passed.
- Tests also cover cross-owner/customer access, concurrent booking/business
  creation, expiration, cancellation, price snapshots, wrong webhook signatures,
  amount mismatches, duplicate events, token refresh, and validation errors.
- Integration fixtures exist only in an isolated local test database, which the
  suite removes. Stripe API methods are controlled test boundaries; actual Stripe
  signature verification and real MongoDB transactions are exercised. These tests
  do **not** constitute a live Stripe Checkout payment test.
- Actual backend connected to configured Atlas, running at port 4000; frontend
  running at port 5173. Root returned 200, guest customer/owner APIs returned 401,
  invalid Stripe signature returned 400, credentialed CORS returned 204, and the
  Vite API proxy reached the backend.
- Guest owner route redirected to login. Public search layout had no document
  horizontal overflow at widths 390, 768, 1366, 1920, and 2560. Authenticated owner
  forms/customer screens still require real accounts for browser verification.
- Configured Stripe **test** credentials authenticated successfully via a
  read-only API call. No charge was made.

## Remaining live-test requirements

The configured database currently has **1 active business, 0 active units,
0 verified active owners, and 1 verified active customer**. Existing-account
browser sign-in has not been completed/provided. No account roles, verification
flags, or sample records were changed to work around this.

For live verification, use a verified active owner account and submit real Unit
information through the implemented owner UI. Then sign in with the existing
customer and complete a Stripe test Checkout while webhook delivery is working.
Owner role assignment remains the existing administrative account/business setup
process; customer registration cannot grant owner privileges.

The Stripe test account has no registered webhook endpoints. The official Stripe
CLI was tried, but Windows application control blocked its executable, including
outside the sandbox. Its temporary dependency was removed. No security controls
were disabled. Use an allowed official CLI installation/local listener or a
deployed publicly accessible HTTPS webhook endpoint. Set `STRIPE_WEBHOOK_SECRET`
to that listener/endpoint's actual secret and restart the backend. Until then,
live Checkout → webhook confirmation remains **unverified**.

Unsupported features remain intentional unavailable states: public Listing
records, paid refunds, review submission/history, date-specific owner rates and
calendar editing, payouts/escrow reports, and account profile/preference editing.

## Changed files in this continuation

Backend: `controllers/customer.js`, `controllers/owners_crude.js`,
`routes/ownerRoutes.js`, `models/business.js`, `models/Unit.js`,
`middlewares/multer.js`, `middlewares/errorMiddleware.js`,
`tests/booking.test.js`, and `README.md`.

Frontend: `src/App.jsx`, `src/api/{client,customer,owner}.js`,
`src/auth/navigation.js`, `src/utils/booking.js`, `src/components/UI.jsx`,
`src/pages/{AuthPages,PublicPages,BookingFlow,CustomerPages,OwnerPages,OwnerLive,OwnerManagement}.jsx`,
`src/styles.css`, `tests/{customer-flow,owner-flow}.test.js`, and `package.json`.

## Local commands and configuration

Existing local services are running. To start them in separate terminals:

```powershell
cd C:\Users\abdullahi\Documents\faaro-bookings-api-main\backend
node server.js
```

```powershell
cd C:\Users\abdullahi\Documents\faaro-bookings-api-main\client
npm run dev
```

Run checks (the local replica set used in this session is on port 27117):

```powershell
cd C:\Users\abdullahi\Documents\faaro-bookings-api-main\backend
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27117/?replicaSet=rsFaaroAudit'
npm test
```

```powershell
cd C:\Users\abdullahi\Documents\faaro-bookings-api-main\client
npm test
npm run build
```

Current URL configuration: `CLIENT_URL` and `FRONTEND_URL` are
`http://127.0.0.1:5173`; `PORT=4000`; frontend uses `VITE_API_URL=/api` and the
existing Vite proxy. Database/JWT/Stripe credentials remain in local `.env`.
The remaining payment configuration is a reachable webhook destination and its
matching `STRIPE_WEBHOOK_SECRET`. See backend/README.md and .env.example for
deployment configuration. Never commit real secrets.
