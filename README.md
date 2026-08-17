# EFood Full-Stack

Responsive food-ordering site with a dependency-free Node.js backend.

## Run

```powershell
node server.js
```

Open <http://localhost:4173>. Do not open `index.html` directly: authentication and orders use the API.

## Backend features

- Registration, login, logout and HttpOnly cookie sessions
- Required email verification with expiring six-digit codes and resend support
- Password hashing with Node.js `scrypt` and per-user salts
- Profile editing and delivery-address storage
- Current-password verification and password changes
- Email/SMS password recovery codes with expiry, attempt limits and rate limits
- Resend email and Twilio SMS adapters
- Authenticated order creation and per-user order history
- Newsletter subscriptions
- Automatic order rows in Google Sheets through a Google Apps Script webhook
- Server-side validation, origin checks and security headers
- Atomic JSON persistence in `data/db.json`

## Email and SMS

Copy `.env.example` to `.env`, provide Resend and/or Twilio credentials, and load those environment variables before starting Node. In development, the API returns a `devCode` so recovery can be tested without paid providers. In production, recovery fails safely when the selected provider is not configured.

## API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `GET|PUT /api/account`
- `POST /api/auth/change-password`
- `POST /api/auth/recovery/request`
- `POST /api/auth/recovery/confirm`
- `GET|POST /api/orders`
- `POST /api/subscribers`

## Production notes

The JSON store is suitable for this single-instance project and local deployment. For multiple server instances, replace it with PostgreSQL and use a shared session store. Set `NODE_ENV=production`, serve over HTTPS, configure `APP_ORIGIN`, and keep provider secrets outside source control.

## Google Sheets orders

The ready-to-deploy Apps Script is in `google-apps-script.gs`. Deploy it as a web app that executes as you and is accessible to anyone, then set `GOOGLE_SHEETS_WEBHOOK_URL` and the same long random `GOOGLE_SHEETS_WEBHOOK_SECRET` in `.env`. Each order number is inserted only once.
