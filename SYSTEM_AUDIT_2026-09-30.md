# Faaro system audit — 30 September 2026

## Scope and evidence

This was an audit, not an implementation task. Application source, routes, models, account roles, catalog records, and bookings were not edited. Tests used isolated local databases; no sample records were inserted into the configured application database. The only authored deliverable is this report.

Inspected the backend entry points, package manifests/lockfiles, all routes, controllers, models, middleware, configuration, utilities, tests, and the complete React source, API services, routing, layouts, navigation, and tests. Browser checks used the existing customer session supplied by the user. Owner and admin authenticated browser sessions were not supplied.

Status definitions:

- **COMPLETE:** implementation and the stated verification pass. This does not mean every external production dependency has been verified.
- **PARTIAL:** some useful functionality exists, but the requested flow or management capability is incomplete.
- **BROKEN:** a reproduced failure or a definite contradiction in the implementation.
- **MISSING:** no functional implementation/API exists. An unavailable screen or a model alone does not implement a feature.
- **BLOCKED:** verification needs an account, external delivery configuration, or other prerequisite that was unavailable during this audit.

The architecture is **User → Business → Unit → Booking → Stripe**. There is no Listing model/API/collection. No Listing model is needed to resolve the findings below. Payment identifiers and status currently live on Booking; there is no separate payment management API.

## Executive findings

1. **The actual Stripe test payment succeeded, but booking confirmation failed.** At `2026-09-30T18:07:54Z`, the existing reservation's Stripe Session was `complete / paid`, for USD 20. Its amount, currency, and booking metadata matched the database. The database still held `status: progress`, `paymentStatus: unpaid`, `isValid: false`, with no recorded confirmation event.
2. Stripe returned **zero registered webhook endpoints** for the configured test account. A matching `checkout.session.completed` event exists. No successful application delivery was demonstrated. A working local listener or registered reachable endpoint and its matching signing secret still need verification. The code's webhook tests pass; that does not prove external delivery works.
3. The real **published Unit → customer catalog → detail → availability/quote → checkout** connection works. It is not broken at Unit publication or frontend catalog rendering.
4. Confirmation also occurs from overdue-hold reconciliation and the cancellation controller after retrieving a paid Stripe Session. These calls do not fake payment, but they violate the requested **verified-webhook-only confirmation** policy.
5. Owner suspension does not withdraw the owner's active Business/Units from customer booking. The account is blocked from signing in, but its inventory can remain bookable.
6. Home and public listing screens remain placeholders even though signed-in customer Unit APIs now exist. Several management features have only unavailable UI, and admin Units has no screen/route.
7. **320px responsiveness fails on scrollable pages.** `body { min-width: 320px }` forces a 320px document into a 305px content viewport when the scrollbar occupies 15px. The wider checked pages did not overflow.

---

# BACKEND

## COMPLETE

### Authentication core

Implementation: [auth controller](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/auth.js), [User model](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/models/User.js), [authorization middleware](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/middlewares/authmiddleware.js).

- Registration sets `isVerified: true`, does not generate a registration verification token, and does not call verification email delivery. It succeeds without SMTP configuration in the integration test.
- Required fields, 6–24 character password limits, duplicate email/phone checks, bcrypt hashing, customer role defaults, and active account defaults remain in place.
- Immediate login, incorrect-password rejection, JWT signing/expiration, refresh cookie handling, token-version checks, suspended-account rejection, and role authorization pass the existing integration tests.
- Login, refresh, and protected middleware no longer require `isVerified`.
- `/verify-email` and `/resend-verification` still exist and their legacy verification flow is tested.
- `sendMail` remains in use. Forgot/reset password deliver through a local SMTP server in the integration test; reset invalidates old refresh tokens. The configured SMTP server also accepted a read-only connection check. No password-reset email was sent to a real user's mailbox during the audit.

Email format validation and legacy account password recovery have separate defects below.

### Customer Business/Unit catalog

Implementation: [customer controller](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/customer.js:23).

- Active Businesses and active Units under active Businesses are returned.
- Unpublished Units and suspended Businesses are excluded.
- Empty customer lists return HTTP 200 and an empty array.
- Unit and Business details validate IDs and reject unavailable records.
- Customer authorization applies to the entire customer router.
- Real catalog/detail requests succeeded in the authenticated browser; existing Unit images loaded.

### Owner Business/Unit operations

Implementation: [owner routes](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/routes/ownerRoutes.js), [owner controller](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/owners_crude.js).

- Business read/create/update and Unit read/create/update/soft deactivation exist.
- Ownership comes from the authenticated user and Business relationship, not a submitted owner ID.
- Only owners can use owner routes; missing authentication and wrong role are rejected.
- Publish/unpublish use `Unit.active`. The customer catalog respects this field.
- Hotel, car, and apartment specifications are supported by the existing Unit model/controllers.
- Owner IDOR protection and the Business → Unit → publish → customer visibility pipeline pass isolated HTTP/database tests.
- Images use the existing multipart/Cloudinary integration, with count/type/size limits and error cleanup. The configured Cloudinary account answered a read-only ping. A real upload was not performed during this audit.

### Booking calculation and reservation protection

Implementation: [Booking model](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/models/Booking.js), [booking service](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/services/booking.js), [booking controller](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/customer.js:114).

- Availability and quote are returned by the same availability endpoint; no separate quote route is required.
- Dates, past dates, duration, Unit/Business validity, and server-side USD prices are validated.
- Client totals are not trusted. Booking preserves `unitPrice`, `currency`, `quantity`, `subtotal`, `fees`, `totalAmount`, and `amountMinor`.
- Stripe Checkout receives the same server-calculated cents amount.
- A MongoDB transaction increments `Unit.bookingRevision` before checking conflicts and inserting a hold. This serializes competing reservations for the same Unit. The concurrency test returned one success and one conflict, not two reservations.
- Pending records have setup/checkout expiration information; normal Checkout creation failure releases the hold.
- Customer booking list/detail and checkout recovery are scoped to the authenticated customer.
- Unpaid cancellation is ownership checked and releases the hold; paid cancellation is rejected pending a refund workflow.
- Owner paid booking list/detail is scoped to the owner's Business.

### Stripe handler implementation

Implementation: [app middleware order](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/app.js:16), [webhook controller](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/stripeWebhook.js), [confirmation service](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/services/booking.js:54).

- `POST /api/stripe/webhook` is mounted with `express.raw` before global JSON parsing.
- Signature verification remains enabled. Invalid signature rejection passed both HTTP testing and the running backend check.
- Completed/successful async Checkout events confirm only paid sessions; expired/failed sessions update unpaid holds.
- Confirmation checks the stored Stripe Session relationship, booking metadata, payment mode, amount, and currency.
- Atomic state guards make repeated confirmation idempotent. Duplicate signed event tests did not create duplicate bookings or confirmations.
- The success URL is not used as proof of payment. The actual frontend success page continued showing pending backend status.

### Configuration and error handling already implemented

- Startup validates database/JWT configuration, valid frontend/client URLs, and production payment/email/image credentials.
- MongoDB transaction capability is checked at startup.
- Credentialed CORS worked for the actual frontend origin; the Vite API proxy reached the backend.
- Async handlers and centralized error middleware cover validation, duplicate keys, uploads, JWT errors, and unexpected failures. Production 500 responses are generic; logged errors exclude request bodies and secrets.
- `uuid` exists in the manifest, lockfile, and installed dependencies. ESM imports and backend imports pass.

## PARTIAL

| Feature | What exists | What is incomplete |
|---|---|---|
| Logout | Clears the refresh cookie and frontend session | Already issued access/refresh tokens are not revoked by logout; no session/token registry or token-version change in logout |
| Fresh identity/role restoration | Refresh validates the real DB account and returns an access token | No fresh user/role response or current-user endpoint; frontend restores a cached login snapshot |
| Search/filtering | Full active catalog is returned; frontend performs text/category/price filtering | No server-side search, filtering, or pagination; no availability/guest-count filtering of catalog results |
| Hold expiration | Signed expiration events and overlapping request reconciliation can expire holds | No scheduled reconciliation worker; booking list/detail can retain stale pending status; legacy pending records without expiration are not covered by the overdue query |
| Booking lifecycle | `progress`, `confirmed`, `expired`, `cancelled`, `completed` statuses exist | No completion/check-in/handover transition implementation; legacy price snapshots are not backfilled |
| Owner booking management | Paid booking list/detail and code verification | Pending/expired/cancelled records with `isValid: false` are not included; no operational check-in mutation |
| Images | Upload and append images | No remove/replace image API; the five-image cap can prevent replacement once full |
| Booking documents | Optional backend upload and signed private delivery | Frontend checkout does not offer the upload; owner detail does not display the returned private-document link; legacy public document migration is absent |
| Admin | Users, Business list, suspend user, customer-to-owner Business creation | No reactivation, owner approval workflow, Business status/update management, advanced operational resources, or reports |
| Webhook tracking | Atomic booking transition plus last event identifier | No full event-processing/delivery ledger for replay/support investigation |
| Production auth hardening | Password/JWT/status/role protection | No login/recovery rate limiting; refresh-cookie endpoints have no explicit CSRF controls. These were code inspection findings, not penetration testing |

Owner onboarding currently requires a pre-existing owner role. Public registration creates customers. The admin promotion API creates the Business while promoting the customer. Consequently, the standard promoted owner already has a Business; owner self-creation is useful only for an already provisioned owner without one. There is no customer application/owner approval onboarding workflow.

`CheckBooking` checks ownership, paid validity, code, acceptable status, and end date. It returns verification, not check-in. It does not require arrival/start date to have occurred. Treating that result as an actual check-in would be incorrect.

## BROKEN

### B1 — Live paid reservation remains unconfirmed — high priority

- Stripe: `status=complete`, `payment_status=paid`, USD 20, matching amount/currency/metadata.
- Booking: `status=progress`, `paymentStatus=unpaid`, `isValid=false`, no confirmation event.
- Stripe: matching completed event exists; registered webhook endpoint count is zero.
- Customer success return and recovery both still wait for backend confirmation.

The exact external delivery failure cannot be reduced to a code bug from these checks alone. Endpoint/listener reachability, event forwarding, and the corresponding signing secret need verification. The result is nevertheless an observed end-to-end confirmation failure.

### B2 — Confirmation is not exclusively driven by verified webhook events — high priority

[Overdue reconciliation](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/services/booking.js:106) and [cancellation](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/customer.js:311) call `confirmCheckoutSession` after retrieving a paid Session. The amount/session checks still apply; these are not browser-success confirmations. However, they are not verified webhook events, contrary to the required architecture and the Booking schema comment.

### B3 — Suspended owner's catalog remains bookable — high priority

[User suspension](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/admin_crude.js:18) changes User status. Customer catalog/detail/booking checks consider Business status and Unit activity, not the owner's User status. Suspension therefore blocks owner authentication without necessarily withdrawing inventory. This is a definite code-level policy gap; no real owner was suspended to demonstrate it.

### B4 — Legacy unverified users cannot obtain a password-reset email

[Forgot password](C:/Users/abdullahi/Documents/faaro-bookings-api-main/backend/controllers/auth.js:278) retains `user?.isVerified && user.email`. Legacy unverified accounts can now login/refresh, but reset mail is suppressed for them. The configured database contains a legacy unverified active customer. New verified registrations are unaffected.

### B5 — Backend email syntax validation is missing

Registration checks for a nonempty email string, and the schema normalizes/uniquely indexes it; neither validates email syntax. Offline model validation accepted `not-an-email`. HTML email inputs do not protect direct API requests.

### B6 — Review validation accepts coercible invalid types

The Review model rejects out-of-range/fractional values and accepts 1–5. Mongoose number casting still accepts `true` as 1 and `"3"` as 3; this was checked with model validation. There is currently no review API, so this becomes relevant when that API is implemented.

### B7 — Fresh setup documentation/configuration is inconsistent

- Backend `.env.example` uses port 5000; client proxy example points to 4000. Current running configuration uses 4000 and works, but copying both examples does not produce that configuration.
- The database example is a standalone localhost URI while booking startup requires a replica set/transaction-capable database.
- Client README says customer/Unit/booking/owner APIs do not exist and registration needs verification mail; both claims are stale. Backend documentation also retains verification-specific wording.

## MISSING

- Paid booking cancellation/refund requests, approval, Stripe refunds, refund history.
- Review creation/read/edit/moderation APIs; Review is currently a model only.
- Favorite APIs; Favorite is a model plus migration script, not a working customer feature.
- Owner calendar, blocked dates, date-specific prices, earnings, payouts, settlement/escrow operations.
- Booking check-in/handover/completion workflow and receipt generation.
- Booking/payment notifications; SMS helper presence is not a connected notification system.
- Current-user/profile update/preferences/account settings APIs.
- Public/guest Business/Unit catalog access.
- Admin Unit, booking, payment, refund, review, reporting, owner approval, Business status/update, user reactivation, and operational audit-log APIs.
- Scheduled hold reconciliation/expiry processing.

`paymentStatus: refunded` and `status: completed` enum values do not mean refund/completion functionality exists.

## BLOCKED

- Successful external Stripe webhook delivery and resulting real confirmation are not verified; the current real paid booking fails this step.
- Live owner/admin authenticated browser/API CRUD verification needs their respective sessions. The customer session cannot perform those operations.
- Real Cloudinary image upload was not performed; ping and controlled upload tests passed.
- External mailbox receipt of password-reset mail was not tested; SMTP connection and local delivery/reset integration passed.
- Card/apartment-specific live owner flows and positive admin CRUD have no demonstrated browser results; they should not be described as fully tested.

---

# FRONTEND

## COMPLETE

For the tested customer flow, the following pages have functional API integration and intentional loading/error/empty handling:

- Login, registration, refresh/session restoration, protected routes, optional verification/resend, forgot/reset password UI.
- Signed-in customer catalog and search using actual Business/Unit responses.
- Unit cards, details, real images, hotel/car/apartment specification renderers.
- Date selection, availability and server quote, checkout request construction and Stripe URL handling.
- Customer booking list/detail, pending checkout recovery, unpaid cancellation integration.
- Stripe success/cancel return screens reading backend status; no success-URL confirmation.
- Customer dashboard counts derived from real bookings.
- Reusable buttons, fields, selects, cards, badges, states, modal, site header, dashboard navigation, and role guards.

Live browser evidence: real Unit and four images rendered; category/city/price filtering worked; a two-day future availability request returned a USD 40 quote; dates and Unit ID passed to checkout; the current real booking appeared in list/detail. Mobile sidebar navigation worked. Customer access to `/owner/business` and `/admin/users` showed Access restricted. No captured browser console errors appeared in the checked customer tab.

The user supplied the already signed-in session. I did not claim to enter/test that account's password myself. Isolated backend tests separately exercise actual register/login/refresh HTTP endpoints.

## PARTIAL

### Customer feature matrix

| Screen/feature | UI exists? | API/data connection | Current status |
|---|---|---|---|
| Register | Yes | Real register endpoint; success message then login link | Registration connected; automatic login is missing |
| Login/logout | Yes | Real endpoints, bearer token and refresh cookie | Connected; logout does not revoke previously issued tokens |
| Home | Yes | No real catalog feed; category/search links only | Placeholder sections even for signed-in customers |
| Search/results | Yes | Real catalog for customers; local category/text/price filtering | Connected; guest access, availability/guest filters, ratings/amenities/sort/map/pagination unavailable |
| City/location | Yes | Case-insensitive text match includes Business city | Working local search, not an exact/server city filter |
| Unit cards/details/images/specifications | Yes | Real Unit and Business APIs | Working in live customer browser |
| Availability/quote | Yes | Same real availability endpoint | Working with selected dates |
| Checkout/Stripe redirect | Yes | Real booking POST and returned `checkoutUrl` | Implemented; real reservation and paid Stripe Session exist |
| Success/cancel | Yes | Real booking GET/polling/recovery | Displays pending correctly; actual confirmation fails upstream |
| My bookings/details | Yes | Real scoped booking APIs | Real pending booking displays; paid lifecycle cannot finish until confirmation |
| Cancellation/refunds | Yes | Unpaid cancel is connected; refund UI unavailable | Paid cancellation/refunds missing |
| Reviews | Yes | No review API | Intentional unavailable UI |
| Profile | Yes | Cached real login user | Read-only snapshot; no fresh profile/update API |
| Settings | Yes | No settings API | Disabled/unavailable controls |
| Public `/listing` detail | Yes | No API request | Placeholder; not the functioning customer Unit detail page |
| Receipts/documents | Some design UI | No receipt generation; document API is not exposed in customer form | Incomplete |

### Owner feature matrix

Source: [owner management](C:/Users/abdullahi/Documents/faaro-bookings-api-main/client/src/pages/OwnerManagement.jsx), [owner live pages](C:/Users/abdullahi/Documents/faaro-bookings-api-main/client/src/pages/OwnerLive.jsx), [owner placeholders](C:/Users/abdullahi/Documents/faaro-bookings-api-main/client/src/pages/OwnerPages.jsx).

Every owner route requires the owner role. Backend operations separately enforce ownership. Loading/error feedback exists for connected data/forms. Their positive browser behavior remains blocked by the unavailable owner session.

| Screen/feature | UI exists? | API connected? | Current status |
|---|---|---|---|
| Dashboard | Yes | Business, Units, paid bookings | Real counts; earnings/payout values unavailable |
| Create/edit Business | Yes | GET/POST/PATCH Business with multipart images | Implemented; onboarding role prerequisite applies |
| Unit list | Yes | Real Units GET | Published/draft filters and edit navigation exist |
| Create/edit Unit | Yes | POST/PATCH Unit | Real model fields and validation/errors; no sample defaults |
| Hotel/car/apartment fields | Yes | Existing Unit/controller fields | Connected in source; not all categories tested live |
| Save unpublished/publish/unpublish | Yes | `active` sent to real POST/PATCH | Backend pipeline covered by integration tests |
| Delete/deactivate | No explicit deletion UI | DELETE service exists but is not called from UI | Partial; unpublish still deactivates via PATCH |
| Upload images | Yes | Multipart existing backend upload | Append-only; no removal/replacement |
| Bookings/detail | Yes | Real owner booking GETs | Paid records only; current unconfirmed paid Stripe booking is not eligible yet |
| Check booking | Yes | Real code verification POST | Verification only; no check-in transition; submit lacks busy guard |
| Calendar/availability management | Yes | None | Unavailable panels/cells, not real availability data |
| Earnings/payouts/reviews | Yes | None | Unavailable |
| Profile/settings | Yes | Cached user / no settings API | Read-only/disabled |

### Admin feature matrix

Source: [admin pages](C:/Users/abdullahi/Documents/faaro-bookings-api-main/client/src/pages/AdminPages.jsx).

Existing admin pages require the admin role. Positive authenticated browser behavior is unverified without an admin session.

| Screen/feature | UI exists? | API connected? | Current status |
|---|---|---|---|
| Dashboard | Yes | Real users/Business lists | User/Business counts real; financial/booking/queue sections unavailable |
| Users | Yes | List users, suspend | Connected in source; no reactivation |
| Owners | Yes | User list filtered by actual owner role | Directory exists; no approval API |
| Businesses | Yes | Business list and customer-to-owner creation | Real API integration; edit/status/approval unavailable |
| Units | No | No admin Unit API | Missing page, navigation, and backend capability |
| Bookings/payments/refunds/reviews | Yes | None | Unavailable table/UI sections |
| Reports/statistics/settings | Yes | None | Unavailable |
| Owner approval | Queue UI only | None | No approval workflow |
| Avatar/profile destination | Avatar link exists | Route absent | Broken `/admin/profile` destination |

### Shared behavior

- API services use `/api` via `VITE_API_URL`, actual endpoint paths/methods, bearer headers, credentialed cookies, and single-flight refresh. No invented endpoints are used by the connected flows.
- Service errors are displayed instead of substituted with fake application records.
- Read-only cached profile/role data is genuine login data, but can be stale.
- Modals have a dialog role and close controls but lack focus trapping, Escape handling, focus restoration, and body scroll locking.
- Unsupported sections often look intentional but do not implement the requested full interaction/design flows. Screen presence is not functional completeness.

## BROKEN

1. **320px overflow:** repeated on Home, search, login/register, listing placeholder, reset password, customer dashboard, loaded Unit detail, checkout, booking detail, and both payment returns. Root cause is the body minimum width combined with scrollbar width.
2. **Search Back navigation keeps stale destination input/filter:** `SearchPage` initializes query state from the URL once; changing history does not synchronize it. Reproduced URL returning to `/search` while the input/filter retained the previous query.
3. **Home dates/guest inputs do nothing:** search submission forwards category and text only. Selected dates/occupancy do not reach results or checkout.
4. **Admin avatar leads to 404:** shared DashboardLayout points to `/admin/profile`, but App has no such route. `/admin/units` also returns 404 and has no navigation/page.
5. **Startup refresh erases the cached session on any failure:** AuthProvider's refresh catch clears it for network/server failures as well as invalid credentials. The reusable API client's in-session refresh behavior distinguishes network errors; startup does not.
6. **Stale Unit detail state on an ID change:** detail loading does not clear the previous Unit/Business/quote, cancel older requests, or hide old content after a new load fails. This is a code-confirmed state handling defect; a live cross-ID race was not forced.
7. **Stale feature/copy claims:** Home still refers to email activation; public placeholder wording and client README imply existing Unit/availability/booking/owner capabilities do not exist.

## MISSING

- Automatic login after registration.
- Functional public catalog/Home feed and listing-design connection to Business/Unit data.
- Admin Units page and a valid admin profile destination.
- Explicit owner delete/deactivate action; image removal/replacement UI.
- Functional profile editing/settings, refunds/reviews, calendar/date pricing, earnings/payouts, receipts and operational booking transitions.
- Functional help/policy navigation: Help has no handler; footer policies are static text and registration policy names are not linked.
- Completed handling for the advanced filters and design actions that currently remain disabled.

## BLOCKED

- Owner/admin authenticated data loading, form submission, tables, and modals cannot be certified from a customer session. Code/API tests and guards are separate evidence, not substitutes for those browser checks.
- Successful live paid booking confirmation is blocked by the webhook delivery failure.
- Pixel-exact reproduction of all nine reference screens is not certified. Their core page families exist, but advanced interactions are unavailable and real data is sparse. No fake cards, metrics, prices, or reviews were added for visual matching.

---

# FRONTEND ↔ BACKEND

## Confirmed working request chains

| Frontend | API service → route/controller | Model/response → UI |
|---|---|---|
| AuthPages / AuthProvider | auth service → `/api/auth/*` → auth controller | User/public data and access token → real session, refresh and role guards |
| CustomerCatalog/SearchPage | customer service → GET Businesses/Units → customer controller | Business/Unit `data` arrays → mapped cards and local filters |
| CustomerUnitDetail | GET Unit then Business → customer controller | Real images/specifications/address → detail UI |
| Availability/checkout quote | GET Unit availability with `startDate,endDate` | Conflict query + price calculation → `available`, quantity, snapshot amounts |
| BookingCheckout | POST `/customer/booking` with Unit/Business IDs and dates | Transactional Booking + Stripe Session → `checkoutUrl` redirect |
| PaymentReturn/My bookings/detail | GET bookings or scoped booking; `includeCheckout=true` for recovery | Booking snapshot/status + safe recovery state → pending/confirmed UI |
| OwnerBusinessLive/UnitEditor | owner service → Business/Unit GET/POST/PATCH | Authenticated owner relationship and FormData → editable real records |
| OwnerBookingsLive/detail | `/owner/booking` GETs and check-booking POST | Business-scoped paid Booking → list/detail/code verification |
| Admin users/owners/businesses | admin service → existing users/owners/suspend/businessOwner routes | Actual User/Business lists and promotion transaction → directory/create forms |

Important contract details: admin `/users/owners` returns Businesses, not owner User records; the frontend correctly uses it as the Business list. Quote is contained in availability. `progress` means pending payment. Booking history uses snapshot amounts, not the Unit's current price. No wrong HTTP method or submitted field was found in the connected service functions inspected.

## Integration problems and required work

| Feature | Frontend file/page | Backend route/controller | What is wrong / status | What needs to be done after approval |
|---|---|---|---|---|
| Live confirmation | `BookingFlow.jsx` PaymentReturn/booking detail | `/api/stripe/webhook`, stripeWebhook | **BROKEN:** actual paid test Session remains unpaid in DB | Establish verified Stripe delivery, correct signing secret, inspect delivery responses, replay the actual event safely, then recheck the booking |
| Webhook authority | BookingFlow pending actions | customer cancel; booking service reconciliation | **BROKEN contract:** other request paths can confirm paid Sessions | Make the policy explicit and enforce verified-event-only transition without losing reconciliation safety |
| Owner suspension | CustomerCatalog/checkout | admin suspend + customer catalog/booking | **BROKEN:** active inventory ignores suspended owner's account | Apply one consistent owner/Business availability policy across browse/detail/quote/create |
| Password recovery | AuthPages ForgotPassword | auth forgot-password | **BROKEN:** legacy unverified accounts receive no recovery mail | Remove only the obsolete recovery eligibility condition; preserve reset/token security |
| Email validation | AuthPages Register | auth register / User | **BROKEN:** backend only checks nonempty string | Validate email syntax server-side and cover direct API submissions |
| Session restoration | AuthProvider.jsx/profile/role routes | refresh returns token only | **PARTIAL:** stale real cached identity/role; network startup failure clears session | Add reliable fresh identity contract when authorized; distinguish transient failure in the frontend |
| Home/catalog | PublicPages.jsx Home/listing | Customer Business/Unit APIs are authenticated | **PARTIAL:** Home uses unavailable sections even for customers | Reuse Unit/Business integration; decide guest access separately; create no Listing model |
| Search intent | PublicPages.jsx Home/SearchPage | No server search/date filters | **BROKEN/PARTIAL:** dates/guests dropped, Back query stale | Preserve/synchronize search state; define supported filters without fake availability |
| Owner deactivation | OwnerManagement.jsx Units | DELETE `/owner/units/:id` | **PARTIAL:** service exists, explicit UI action absent | Expose existing soft-deactivation contract with clear action feedback |
| Images | OwnerManagement.jsx editor | owner Business/Unit image uploads | **PARTIAL:** append-only API/UI | Add removal/replacement only when authorized, preserving ownership and Cloudinary cleanup |
| Paid cancellation/reviews | CustomerPages.jsx / OwnerPages.jsx / AdminPages.jsx | No matching APIs | **MISSING:** professional unavailable UI is not a workflow | Implement dependent backend capability before enabling actions |
| Check-in/completion | OwnerLive.jsx detail/dashboard | CheckBooking; Booking status enum | **PARTIAL:** code verification only | Define and implement real operational state transitions; do not label code verification as arrival |
| Admin navigation/resources | UI.jsx/App.jsx/AdminPages.jsx | Advanced admin APIs absent | **BROKEN/MISSING:** profile 404 and no Units page | Correct the existing link; plan actual resource APIs and connect screens after authorization |
| Profile/settings | CustomerPages/OwnerPages/AdminPages | No current-user/update/settings API | **PARTIAL/MISSING:** cached read-only identity and disabled settings | Build authenticated profile/settings contract before enabling editing |
| Documents/receipt | BookingFlow.jsx/OwnerLive.jsx | Optional booking upload/private document delivery; no receipt API | **PARTIAL/MISSING:** upload/link not surfaced; receipts absent | Connect existing document capability where needed; plan actual receipt generation |
| Mobile layouts | styles.css/shared layouts | No backend dependency | **BROKEN at 320px** | Remove the width conflict, verify form/nav visibility and scrollable tables at all requested widths |
| Fresh local setup | client env/README | backend env/example/server | **BROKEN documentation/defaults** | Align ports, replica-set setup and current API/auth documentation |

---

# CRITICAL FLOW

**PASS does not imply a live owner mutation was performed.** The evidence column distinguishes actual customer/payment observations from isolated integration tests.

| Step | Result | Evidence / qualification |
|---|---|---|
| Owner authentication | **PASS — automated** | Real JWT/role middleware integration; positive owner browser sign-in **BLOCKED** without an owner session |
| Create/manage Business | **PASS — automated** | Existing authenticated, unique, ownership-scoped API tests; live form submission not performed |
| Create/save Unit and images | **PASS — automated, image upload live BLOCKED** | Real HTTP/MongoDB Unit flow; upload provider controlled in tests; configured Cloudinary ping passed |
| Publish Unit | **PASS — automated** | `active` transitions and customer visibility tested; current real active Unit also present |
| Customer sees Unit | **PASS — live** | API returns current published Unit; authenticated catalog/search and images render |
| Open/select Unit and dates | **PASS — live** | Actual detail and selected future date range |
| Availability | **PASS — live + automated** | Real quote request; unavailable/concurrent cases in tests |
| Quote | **PASS — live + automated** | USD 20 × two days = USD 40 returned by backend |
| Create Booking | **PASS — actual record + automated** | Current real reservation exists; transaction/snapshot and concurrency tested |
| Stripe Checkout/payment | **PASS — actual Stripe test mode** | Existing Session complete/paid, USD 20, correct metadata and amount; not a production charge |
| Verified webhook reaches backend | **FAIL — live** | Matching completed event exists, zero registered endpoints, no recorded application confirmation; signed HTTP test separately passes |
| Confirmed Booking | **FAIL — live** | Still `progress/unpaid/isValid=false`; browser does not fake success |
| My bookings/detail | **PASS — live display** | Current reservation displays its actual pending status and snapshot |
| Owner sees paid booking | **BLOCKED / upstream failure** | Owner API requires `isValid=true`; current record is not confirmed; no owner browser session |

### Full customer flow

Register → immediate Login → refresh → protected request passes the isolated real-HTTP auth tests. Automatic frontend authentication after registration is **MISSING**. The provided existing customer session browsed, filtered, quoted, opened checkout, and displayed the current real booking. Actual Stripe test payment is successful; webhook confirmation is not. Therefore the full customer flow is **not end-to-end complete**.

### Full owner flow

Business → Unit → draft/publish → customer catalog → customer booking → signed confirmation passes isolated HTTP/MongoDB tests with controlled Stripe/Cloudinary boundaries. The current real catalog Unit proves stored published inventory reaches the customer frontend. Live owner editing/uploading and owner booking display are **not certified** without that role's browser session and a confirmed payment.

### Full admin flow

Only users, owners directory, Business list/create promotion, and suspension have connected implementations. Positive admin browser/CRUD verification is **BLOCKED** by the missing admin session. Unit/booking/payment/refund/review/report/approval management is **MISSING**, not a passing flow.

---

# RESPONSIVE FRONTEND

Browser viewport overrides were verified against actual `innerWidth` and reset after testing. Checked document width against **clientWidth**, not just innerWidth, to account for scrollbars.

| Width | Observed result |
|---|---|
| 320px | **FAIL on scrollable pages:** document 320px versus content viewport 305px; 15px horizontal overflow. Mobile search/header controls can be clipped |
| 390px | No horizontal document overflow on the checked public/customer pages; sidebar navigation and search filters work |
| 768px | No measured document overflow; two-column registration feels crowded, particularly account-purpose options |
| 1024px | No measured document overflow on checked pages |
| 1366px | No measured document overflow on checked pages |
| 1920px | No measured document overflow on checked pages; content remains within its configured maximum width |

Public pages checked at every width: Home, search, login, register, listing placeholder, forgot password, reset password, verify email, resend verification.

Loaded customer pages checked across the requested widths: dashboard, catalog, Unit detail with real images, checkout with real quote, booking list, booking detail, success return, cancel return. Short pages such as the current booking list can fit at 320px because no vertical scrollbar is present; this does not resolve the scrollable-page defect. Profile/settings were also inspected in the customer session.

Owner/admin table, editor, and modal behavior at these widths is **BLOCKED for positive browser verification**. Source includes horizontally scrollable table wrappers and responsive layout breakpoints, but this is not evidence of a successful real role-specific visual test. Modal keyboard/focus handling is incomplete by code inspection.

---

# TESTS AND LIVE CHECKS

| Check | Result | Boundary |
|---|---|---|
| Backend `npm test` with local replica set | **35 passed, 0 failed, 0 skipped** | Actual Express HTTP endpoints/JWT/Mongoose and isolated MongoDB databases; tests clean up their databases |
| Frontend `npm test` | **6 passed, 0 failed** | Navigation/confirmation utilities and service contracts; fetch is controlled in service tests, not rendered browser end-to-end coverage |
| Client `npm run build` | **PASS** | Vite production build; 1909 modules, approximately 392KB JS and 51KB CSS before transfer compression |
| Backend imports / installed dependency tree | **PASS** | `uuid` synchronized and installed; `npm ls --depth=0` clean |
| Running backend and Vite proxy | **PASS** | Backend root HTTP 200; guest protected requests 401 through backend/proxy |
| CORS credentialed request | **PASS** | Actual frontend origin accepted |
| Invalid webhook signature | **PASS** | Running route rejects invalid signature with 400 |
| Signed confirmation/duplicate/amount mismatch | **PASS — automated** | Real signature generation/verification with a test webhook secret; controlled Checkout SDK boundary |
| Concurrent overlapping reservation attempts | **PASS — automated** | Real transaction test, one successful hold and one conflict |
| Existing customer authenticated browsing | **PASS — live** | User-provided customer session, real database responses/images/quote/booking |
| Customer wrong-role routes | **PASS — browser** | Owner/admin screens reject customer role |
| SMTP password recovery | **PASS — local integration** | Real sendMail against local SMTP, reset and token revocation; configured SMTP verify also passed |
| Cloudinary | **PASS — connection only** | Real ping; upload boundary controlled in tests |
| Actual Stripe Checkout | **PASS — test mode** | Real completed/paid Session checked read-only |
| Actual Stripe webhook → confirmation | **FAIL** | Actual booking remains pending/unpaid |
| Positive admin CRUD | **NOT VERIFIED** | Existing automated suites do not establish the full positive admin management flow; no admin browser session |
| Live owner CRUD/upload | **NOT VERIFIED** | No owner browser session; relevant isolated backend/API tests pass |
| Lint/type-check | **Not available** | No scripts configured; project uses JavaScript |

Backend tests cover import, owner routing/auth, active/empty catalog, Review range checks, server price/snapshot, frontend URL, raw webhook/signature, valid/duplicate/mismatched events, unpaid expiration/cancellation, customer/owner ownership, Checkout failure cleanup, concurrency, Business uniqueness, publishing, auth security, and password recovery. They do not certify live Stripe forwarding, Cloudinary upload, every React page interaction, or all admin operations.

The automated tests' isolated users/records and controlled external SDK responses are test fixtures only. They are not application fallback data and do not conceal the failed actual Stripe confirmation.

## Commands used / reproducible checks

From the project root in PowerShell, with the same local test replica set running:

```powershell
Set-Location C:\Users\abdullahi\Documents\faaro-bookings-api-main\backend
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27117/?replicaSet=rsFaaroAudit'
npm test
npm ls --depth=0

Set-Location C:\Users\abdullahi\Documents\faaro-bookings-api-main\client
npm test
npm run build
```

The local replica set is required to run the integration suites instead of skipping them. Use an isolated test database/server, never the application's production database for test fixtures.

Existing development processes use backend port 4000 and frontend 5173. Normal start commands, in separate terminals with the configured environment, are `node server.js` in backend and `npm run dev` in client. No backend npm start script exists.

## Environment requirements still relevant

- Transaction-capable `MONGODB_URI`; `ACCESS_TOKEN_SECRET`; `REFRESH_TOKEN_SECRET`.
- Correct `CLIENT_URL` (legacy `Client_URI` supported), `FRONTEND_URL`, and aligned backend `PORT`/client `API_PROXY_TARGET`.
- `VITE_API_URL=/api` when using the configured proxy/reverse proxy.
- Valid `STRIPE_SECRET_KEY` and **signing secret for the actual receiving endpoint/listener** in `STRIPE_WEBHOOK_SECRET`.
- A reachable webhook receiving path `/api/stripe/webhook`; credentials alone do not configure delivery.
- Existing Cloudinary credentials for live uploads and SMTP credentials for real password recovery. SMTP is not a registration prerequisite.
- Explicit production `NODE_ENV=production` for secure production error/cookie behavior. Current environment did not set NODE_ENV during this audit.

No real secrets are included in this report.

---

# MISSING FEATURES — CONSOLIDATED

1. Paid cancellation/refund processing and admin refund management.
2. Working customer/owner/admin review operations and rating aggregation.
3. Favorites operations.
4. Owner calendar, blocked dates, seasonal/date-specific pricing.
5. Earnings, payouts, settlement and actual escrow operations.
6. Check-in/handover/completed booking workflow.
7. Booking/payment notifications and downloadable/printable receipts.
8. Current-user/profile editing/preferences/account settings.
9. Admin Units, bookings, payments, reviews, reports, owner approval, Business status editing, user reactivation and operational logs.
10. Guest catalog access and functional Home catalog feed.
11. Server catalog search/filter/pagination; supported occupancy/date filtering and advanced filter data.
12. Image removal/replacement and frontend exposure of booking-document capability.
13. Automatic frontend authentication after registration.
14. Scheduled overdue-hold reconciliation.

There is deliberately **no proposal to add a Listing model**. Business and Unit should remain the catalog entities.

# FINAL IMPLEMENTATION PLAN

No implementation was started. Recommended dependency order:

1. **Restore and prove Stripe event delivery.** Verify endpoint/listener reachability and signing secret, inspect the completed test event's delivery, then recover the already-paid reservation through the verified event path. Verify amount/status in DB and customer UI; add regression coverage for delivery/recovery failures.
2. **Enforce the intended payment/status policy.** Resolve non-webhook confirmation paths, overdue hold processing, historical pending documents, and observability/idempotent event recovery. Preserve concurrency and amount checks.
3. **Close current security/validation gaps.** Align suspended owner inventory policy, legacy account password recovery, backend email validation, and session refresh/error behavior; define logout revocation expectations and production rate/CSRF controls.
4. **Finish existing customer integration.** Reuse Business/Unit data for the Home/design screens, preserve dates/filter state, fix browser Back and 320px overflow, clarify missing guest/advanced filtering, and fix broken navigation/copy. Do not invent records.
5. **Verify live owner operations.** Obtain an owner session; test real Business/Unit edits, actual image upload, draft/publish/unpublish, customer visibility and confirmed booking display. Surface existing deactivation, then plan image management and document display.
6. **Verify existing admin operations.** Obtain an admin session; test directory, suspension and promotion transactions; correct missing destinations before expanding admin resource management.
7. **Implement dependent missing workflows only after approval.** Profile/settings, operational booking lifecycle, refunds/reviews, calendar/date pricing, notifications/receipts, then earnings/payouts/reports and broader admin capabilities.
8. **Update setup documentation and expand targeted regression/browser coverage.** Align port/replica-set examples and current API descriptions; complete role-specific responsive/form/modal tests at all six widths and one actual test-mode Checkout → signed webhook → confirmed booking run.

## Audit conclusion

The project has a functioning authenticated Business/Unit catalog, server-calculated booking/hold implementation, role/ownership protection, and a passing automated baseline. It is **not a complete booking system yet**: the observed paid test reservation is not confirmed, advanced management workflows are absent, some existing integrations are partial, and 320px layouts overflow. Owner/admin browser completeness is unverified rather than assumed.
