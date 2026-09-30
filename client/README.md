# FAARO frontend

React, JavaScript, Tailwind CSS, React Router, and fetch. The nine supplied design screens guide the layouts. No sample application records or metrics are bundled.

## Run

1. Start the existing backend on port 4000 using the repository's backend instructions.
2. In `client`, run `npm install` and `npm run dev`.
3. Open `http://127.0.0.1:5173`.

`VITE_API_URL` defaults to `/api` in the example environment file. The Vite development proxy forwards `/api` to `API_PROXY_TARGET`. Set `VITE_API_URL` to the deployed backend's API base when deploying without a reverse proxy.

## Connected backend operations

Authentication: register, email verification, resend verification, login, forgot password, reset password, refresh, and logout under `/api/auth`. Login uses the returned user and role. On reload, the app requests a new access token and restores only a user cached from a previous real login, after checking the token's user ID.

Admin: list users, list businesses, suspend a user, and create a business for an active customer under `/api/admin/users`. The admin screens show loading, empty, error, and retry states. Business creation accepts the backend's fields and optional images.

## API gaps reflected in the UI

The backend has no public catalog, listing, unit, availability, booking, inventory claim, payment, refund, review, owner workspace, or reporting endpoints. These screens remain present and show unavailable or empty states; their actions cannot submit data. The owner role is created by the existing admin business creation flow, not public registration.

The refresh endpoint returns an access token without fresh user/role data, and there is no current-user endpoint. A role changed during an existing session cannot be reliably reflected in the frontend until the user logs in again. The backend enforces authorization on admin calls regardless of the frontend route guard.

The backend's empty admin lists are returned as HTTP 404 with a specific message, which the frontend treats as an empty state. The frontend displays any other API error with a retry option. Registration may create the account before email delivery fails; the UI explains this case and offers a verification resend route.

For verification and password-reset emails, configure the backend's `CLIENT_URL` (or legacy `Client_URI`) as an absolute HTTP URL for this frontend, such as `http://127.0.0.1:5173` during local development, and restart the backend. A value like `localhost:5000` produces links that do not open the frontend. The verification page automatically submits the token from a valid emailed link and can also accept a token entered manually.
