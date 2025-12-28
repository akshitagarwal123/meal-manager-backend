# CountWise Frontend API Guide (From Postman Collection)

Source of truth: `docs/CountWise.postman_collection.json`

Base URL: `{{baseUrl}}` (default in Postman: `http://localhost:3000`)

All responses are JSON. Authenticated calls require:
- `Authorization: Bearer <JWT>`

---

## Postman Variables

- `baseUrl`: backend base URL
- `studentToken`: JWT for student role
- `managerToken`: JWT for manager role
- `studentEmail`: student email used for OTP + APIs
- `managerEmail`: manager email used for OTP + APIs
- `otp`: OTP value (in dev you may get it in response if email fails)
- `hostelId`: hostel id used in queries/bodies
- `collegeId`: college id used in profile save
- `date`: `YYYY-MM-DD`
- `dayOfWeek`: `0..6` where `0=Sun ... 6=Sat`
- `from`, `to`: date range for stats/summary (`YYYY-MM-DD`)

---

## Key Concepts (Important for UI)

### Roles

- **Student**: role=`student`
- **Meal Manager**: role=`manager`

### Menu data model (Weekly Template + Date Overrides)

- **Weekly default menu (template)**: stored by `(hostel_id, day_of_week, meal)` in `hostel_weekly_menus`.
- **Date-specific override (exception)**: stored by `(hostel_id, date, meal)` in `meal_calendars`.
- **Read rule**: `override > template > empty default`.

So the UI can:
- show a “default weekly plan” screen (template)
- show a “special day override” screen (exceptions)
- render the final menu by calling `GET /meals/menu` or `GET /user/assigned-meals`

---

## Health

### `GET /ping`
Purpose: health check.

Request:
- No auth.

Response:
- `200 { ok: true, message: "pong" }`

---

## Auth (OTP)

### `POST /auth/send-otp`
Used by: Student and Manager (same endpoint).

Request:
- Body: `{ "email": "<email>" }`

Response:
- `200 { success: true, message: "OTP sent to email" }`
- Dev fallback (if email delivery fails): may also return `otp` in response when non-prod / dev flags allow it.

Notes:
- OTPs are only sent if the email already exists in `users` and is active.

### `POST /auth/verify-otp`
Purpose: verify OTP and receive JWT.

Request:
- Body: `{ "email": "<email>", "otp": "123456" }`

Response:
- `200 { success: true, message: "OTP verified", token: "<JWT>" }`

JWT payload includes:
- `id`, `email`, `name`, `role`, `college_id`, `hostel_id`

### `POST /auth/save-details` (Student profile)
Purpose: updates an existing student profile and can optionally set the current hostel assignment.

Request:
- Body (example):
  - `name`, `email`, `phone`, `roll_no`, `room_no`, `college_id`
  - optional: `hostel_id`

Response:
- `200 { success: true, message: "User details saved", token: "<JWT>" }`

Notes:
- This does **not** create a user. The user must exist already in `users`.

---

## Student APIs (Auth Required)

### `GET /user/qrcode`
Purpose: returns a QR image + payload for attendance marking.

Request:
- Header: `Authorization: Bearer {{studentToken}}`

Response:
- `200 { qr: "data:image/png;base64,...", payload: { user_id, email, hostel_id } }`

### `GET /user/assigned-meals`
Purpose: 7-day view (today → today+6) for the student’s currently assigned hostel.

Request:
- Header: `Authorization: Bearer {{studentToken}}`

Response:
- `200 { hostel_id, from, to: null, meals: [{ date, meal, status, note, items }] }`

How data is computed:
- uses weekly template (`hostel_weekly_menus`) and applies overrides (`meal_calendars`) for those dates.

### `GET /user/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`
Purpose: attended/missed aggregated counts by meal type.

Request:
- Header: `Authorization: Bearer {{studentToken}}`
- Query: `from`, `to`

Response:
- `200 { from, to, hostel_id, attended: {..}, missed: {..} }`

Important:
- The API checks hostel assignment **for the `to` date**. If the student wasn’t assigned on that date → `403 User not enrolled in any hostel`.

### `GET /user/check-status`
Purpose: tells whether the student is enrolled in a hostel.

Request:
- Header: `Authorization: Bearer {{studentToken}}`

Response:
- Not enrolled: `200 { status: 0 }`
- Enrolled: `200 { status: 2, hostel: { id, hostel_code, name, address, college_id } }`

---

## Meals APIs (Auth Required)

### `GET /meals/menu?hostel_id=<id>&date=YYYY-MM-DD`
Used by: Student and Manager (read-only).

Request:
- Header: `Authorization: Bearer <token>`
- Query: `hostel_id`, `date`

Response:
- `200 { hostel_id, date, meals: [{ hostel_id, date, meal, status, note, items }] }`

How data is computed:
- merges date overrides (`meal_calendars`) + weekly template (`hostel_weekly_menus`) + default empty values.

---

## Manager APIs (Auth Required)

### Weekly Template (defaults)

#### `GET /meals/template?hostel_id=<id>&day_of_week=<0-6>`
Purpose: fetch weekly defaults for a hostel (optionally filter by one day).

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Query: `hostel_id`, optional `day_of_week`

Response:
- `200 { success: true, hostel_id, templates: [{ hostel_id, day_of_week, meal, status, note, items, updated_at }] }`

Access control:
- manager must be assigned to the hostel.

#### `POST /meals/template`
Purpose: upsert one weekly template row (default).

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Body:
  `{ hostel_id, day_of_week, meal_type, status, note?, items[] }`

Response:
- `200 { success: true, template: {...} }`

Access control:
- manager must be assigned to the hostel.

### Date Overrides (exceptions)

#### `POST /meals/override`
Purpose: upsert a date-specific override for a meal (holiday/special items).

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Body:
  `{ hostel_id, date, meal_type, status, note?, items[] }`

Response:
- `200 { success: true, override: {...} }`

Notes:
- `POST /meals/menu` is a backward-compatible alias of this endpoint.

#### `DELETE /meals/menu/item`
Purpose: remove a single item from the `items` list in a date override row (`meal_calendars`).

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Body: `{ hostel_id, date, meal_type, item }`

Response:
- `200 { success: true, items: [...] }`

### Attendance (QR scans)

#### `POST /admin/mark-attendance`
Purpose: marks attendance for today (IST) for a student in the manager’s hostel.

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Body: `{ email: "<studentEmail>", meal_type: "snacks", source: "qr" }`

Response:
- `200 { message: "Attendance marked" }`

#### `GET /admin/qr-scans/today`
Purpose: today’s counts (total + per meal).

Request:
- Header: `Authorization: Bearer {{managerToken}}`

Response:
- `200 { date, hostel_id, total, breakdown: [{ meal, count }] }`

#### `GET /admin/qr-scans/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
Purpose: range summary grouped by date+meal.

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Query: `from`, `to`

Response:
- `200 { from, to, hostel_id, total, byDate: [{ date, total, breakdown }] }`

#### `GET /admin/qr-scans/details?date=YYYY-MM-DD&meal_type=snacks`
Purpose: attendee list for a meal on a date.

Request:
- Header: `Authorization: Bearer {{managerToken}}`
- Query: `date` (optional, defaults to today), `meal_type`

Response:
- `200 { date, meal, hostel_id, attendees: [{ email, name, phone, scanned_at }] }`

