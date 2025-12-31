# Production Readiness Notes (Backend)

This repo runs fine for local/dev demos, but production needs some configuration.

## Required env vars (minimum)
- `NODE_ENV=production`
- `JWT_SECRET` (strong random secret)
- DB:
  - Prefer `DATABASE_URL` (Render style), or set `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`

## Recommended env vars
- `QR_TOKEN_SECRET` (separate from `JWT_SECRET` if possible)
- `CORS_ORIGINS` (comma-separated, e.g. `https://app.example.com,https://admin.example.com`)
- Email (OTP delivery):
  - `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` (see `src/config/email.js`)
  - `OTP_EMAIL_TIMEOUT_MS=15000`

## Logging controls
- Request logs:
  - `LOG_REQUESTS=true|false` (enable/disable)
  - `LOG_REQUESTS_MODE=summary|json` (default: `summary`)
- Flow logs (plain tags like `[SEND OTP] ...`):
  - `LOG_FLOW=true|false` (default: `true`)
  - `LOG_SENSITIVE=true|false` (default: `false`, keep `false` in prod)
- JSON logs (pino-like lines from `req.log`):
  - `LOG_FLOW_JSON=true|false` (default: `false`)
  - `LOG_LEVEL=info|warn|error` (default: `info`, but info is suppressed unless `LOG_FLOW_JSON=true`)

## Safer error responses
- By default (when `NODE_ENV=production`), 500 responses do **not** include `details`.
- For debugging only: set `EXPOSE_ERRORS=true`.

## Rate limiting (in-memory)
We added simple in-memory throttles for:
- `POST /auth/user-exists`
- `POST /auth/send-otp`
- `POST /auth/verify-otp`
- `POST /auth/save-details`

For multi-instance production, replace with a shared store (Redis) so limits are consistent across instances.

## Health check
- `GET /healthz` returns `200` if DB is reachable, else `503`.
