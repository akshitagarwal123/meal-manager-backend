# Count Wise (Expo App) — Supported Backend Endpoints (New Schema)

All endpoints return JSON. Authenticated endpoints require:
- `Authorization: Bearer <JWT>`

## Student (role: `student`)
- `POST /auth/send-otp`
- `POST /auth/verify-otp`
- `POST /auth/save-details`
- `PUT /user/update-details` (auth)
- `GET /user/pgs` (auth) — lists hostels (optionally filtered by `college_id`)
- `POST /user/enroll` (auth) — body uses `hostel_id`
- `GET /user/assigned-meals` (auth)
- `GET /meals/menu?hostel_id&date` (auth)
- `GET /user/qrcode` (auth)
- `GET /user/stats?from&to` (auth)
- `POST /user/saveDeviceToken` (auth, optional)

## Mess Manager (role: `manager`)
- `POST /admin/login` — OTP-based (uses `email` + `otp`)
- `GET /meals/menu?hostel_id&date` (auth)
- `GET /meals/template?hostel_id&day_of_week` (auth) — weekly defaults
- `POST /meals/template` (auth) — weekly defaults (admin-only)
- `POST /meals/override` (auth) — date-specific override (exceptions)
- `DELETE /meals/menu/item` (auth)
- `POST /admin/mark-attendance` (auth)
- `GET /admin/qr-scans/today` (auth)
- `GET /admin/qr-scans/summary?from&to` (auth)
- `GET /admin/qr-scans/details?date&meal_type` (auth)

Notes:
- App should use `hostel_id` only.
