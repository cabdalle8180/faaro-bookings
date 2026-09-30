# Faaro bookings API

Copy `.env.example` to `.env`, set real credentials, then run `npm install` and
`node server.js`. MongoDB must be a replica set or sharded cluster: reservations
use transactions to serialize booking attempts for the same unit. The local
frontend uses `http://127.0.0.1:5173`; the backend uses port 4000 in the current
development configuration.

`CLIENT_URL` is the allowed browser origin and the base for verification links.
`FRONTEND_URL` is the Stripe Checkout return origin; it falls back to
`CLIENT_URL`. Both must be valid HTTP(S) URLs. Production startup also requires
the JWT, Stripe, email, and Cloudinary values listed in `.env.example`.

The Stripe webhook endpoint is `POST /api/stripe/webhook`. Register that exact
URL with Stripe and use its signing secret for `STRIPE_WEBHOOK_SECRET`. The route
reads the raw request body and verifies the signature before changing a booking.
The `/payment/success` browser redirect never confirms payment.

Successful `checkout.session.completed` and `checkout.session.async_payment_succeeded`
events confirm only a `complete`, `paid` Checkout Session whose metadata booking ID,
stored Session ID, amount in cents, and currency match the pending Booking. The
atomic transition is `progress` / `unpaid` / `isValid: false` to `confirmed` /
`paid` / `isValid: true`; `confirmedAt`, `stripePaymentIntentId`, and
`lastStripeEventId` are stored on the existing Booking. Replayed events do not
change the confirmation time or create another Booking. Unpaid, unrelated,
invalidly signed, mismatched, cancelled, failed, and expired payments cannot
confirm a Booking. `checkout.session.async_payment_failed` and
`checkout.session.expired` can expire only pending unpaid records, without
downgrading a confirmed Booking.

Payment retrieval, cancellation, and overdue availability reconciliation never
perform this confirmation transition. A paid Session awaiting its webhook keeps
its inventory hold protected. If delivery is missing, restore event delivery;
do not manually mark the Booking paid or use the browser return as evidence.

Customer catalog routes under `/api/customer` require a customer token:
`GET /businesses`, `GET /business/:id`, `GET /units`, `GET /units/:id`, and
`GET /units/:id/availability?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`.
`POST /booking` accepts `unitId`, `businessId`, `startDate`, and `endDate` in JSON
or multipart form (optional `document` image). It returns a pending booking and
`checkoutUrl`. `GET /bookings` and `GET /booking/:id` return only the signed-in
customer's records. `POST /booking/:id/cancel` cancels only unpaid pending holds.
`GET /booking/:id?includeCheckout=true` retrieves the customer's existing Stripe
session for the resume-payment action. It returns an open session URL only after
checking booking ownership, session metadata, amount, currency, and active unit/
business status. Paid/processing sessions wait for confirmation; a browser return
or resume request does not mark a pending booking as paid.

The frontend customer path is `/customer/catalog` → `/customer/units/:id` →
`/checkout?unitId=...&startDate=...&endDate=...` → Stripe Checkout →
`/payment/success?bookingId=...` or `/payment/cancel?bookingId=...`. Sign-in
preserves those query parameters. The success page polls the booking API for up
to three minutes, then offers a manual refresh. Pending bookings also offer
resume-payment and cancellation actions in `/customer/bookings/:id`.

For local Stripe delivery, install the official CLI on a machine where it is
allowed, run `stripe login`, then
`stripe listen --forward-to http://127.0.0.1:4000/api/stripe/webhook`.
Set `STRIPE_WEBHOOK_SECRET` in `.env` to the listener's actual signing secret and
restart the backend. Keep the listener running while completing test Checkout.
The listener's `whsec_...` is not the Dashboard endpoint signing secret or the
Stripe API key. Do not print it in logs or commit `.env`. For local CLI forwarding,
zero registered public endpoints is expected: the CLI supplies the forwarding
connection. Localhost is not a valid publicly reachable destination for Stripe.
For a deployed backend, register its HTTPS `/api/stripe/webhook` URL instead,
subscribe to the four Checkout events above, and use that endpoint's secret.

Before the real local test, check that the backend is listening on port 4000,
the CLI is authenticated to the same Stripe test account as `STRIPE_SECRET_KEY`,
and the listener is ready. Then complete a real test-mode Checkout for an existing
Booking. The CLI must show the matching successful event forwarded to this path
with HTTP 200. Read the Booking through the existing customer API to verify
`confirmed` / `paid`. For a previously paid pending Booking, use Stripe's event
resend facility after configuring a receiving endpoint; do not fabricate/sign
an application event to stand in for actual Stripe delivery. A replay must leave
the same Booking ID and confirmation timestamp unchanged. No new payment or
application-record change is part of the automated tests.

See the official [webhook/local listener guide](https://docs.stripe.com/webhooks)
and [signature troubleshooting](https://docs.stripe.com/webhooks/signature).

Owner routes under `/api/owner` require an owner token. `GET /business`,
`POST /business`, `PATCH /business`, `GET /units`, `GET /units/:id`,
`POST /units`, `PATCH /units/:id`, `DELETE /units/:id`,
`GET /booking`, `GET /booking/:id`, and `POST /check-booking/:id` are scoped to
the owner's business. A unit's `price` is the USD rate per day or night, with
up to two decimal places. The server multiplies it by the booking duration and
stores the charged amount on the booking. No client-provided total is used.

The architecture is **User → Business → Unit → Booking → Stripe payment**.
There is no Listing model, controller, route, or collection. The owner UI uses
`/owner/business`, `/owner/units`, `/owner/units/new`, and `/owner/units/:id/edit`.
Only a verified active account with the existing `owner` role may use these APIs;
customer registration does not grant owner privileges. Role assignment remains
the existing administrative business setup process.

An owner may create one business. A unique `ownerId` index prevents concurrent
duplicate businesses. Business creation accepts `name`, `category`,
`contactPhone`, `city`, `address`, `openHours`, optional `description`, and up to
five `images` (multipart). Updates use the same profile fields; category is fixed
after creation, and owners cannot change ownership or suspension status.

Unit drafts use `active: false`; publishing uses `PATCH /units/:id` with
`{ "active": true }`; unpublishing uses `false`. The editor collects only fields
supported by Unit.js. Hotel details require roomType/beds/capacity; vehicle
details require make/model/seats/plateNumber; apartment details require
bedrooms/bathrooms/maxGuests. Integer capacities and USD rates are validated.
Drafts and units of suspended businesses are excluded from the customer catalog.
Unpublishing preserves existing bookings. Customer `/search` filters published
units returned by the real catalog APIs; no fabricated listing records are used.

Booking lifecycle: `progress` means an unpaid hold; a verified paid Stripe
Checkout event changes it to `confirmed`. A verified expiration/failure changes
it to `expired`; a customer may change an unpaid hold to `cancelled` after its
Stripe session is expired. Confirmed bookings do not become cancelled without a
refund workflow. Legacy paid bookings with `isValid: true` and `status: progress`
remain readable; their historical charged amount cannot be reconstructed from
the current unit price.

Run `npm test` for unit and authentication tests. To run the booking integration
tests, start a **local** MongoDB replica set and set `TEST_MONGODB_URI` to its
local URI before running `npm test`. The integration suite uses an isolated
database, a controlled Stripe test boundary, and cryptographically signed test
webhook payloads. It refuses a non-local MongoDB URI. No real Stripe charge is
made. To migrate legacy Favorite documents from `customaId` to `customerId`,
run `npm run migrate:favorites` after a database backup. The script aborts on
duplicate or conflicting records instead of deleting them.

Set `CLIENT_URL` to the frontend URL (`Client_URI` is also accepted). The API
allows credentialed browser requests from that URL's origin. Browser calls to
`/api/auth/login`, `/api/auth/refresh`, and `/api/auth/logout` must use
`credentials: "include"` so the refresh cookie is stored and sent. Production
cross-site cookies require HTTPS.

Email verification is optional in the current development/testing auth flow.
Registration creates verified customer accounts without a verification token or
SMTP call. Login, refresh, and protected requests do not require email
verification. Password, token-version, account-status, and role checks still
apply. No existing accounts are migrated or assigned a different role.

`POST /api/auth/verify-email` and `POST /api/auth/resend-verification` remain
available for existing verification links. Resend retains its one-minute cooldown
and generic response. `sendMail` is unchanged and still delivers password-reset
email; configure SMTP for password recovery. Production startup continues to
validate SMTP configuration for that functionality.

Password reset invalidates previously issued access and refresh tokens. Users
must sign in again after resetting their password.
