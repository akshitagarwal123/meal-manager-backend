# Count Wise Backend API (New Schema)

Base URL: `http://<HOST>:3000`

All responses are JSON.

## Authentication

Protected endpoints require:
- `Authorization: Bearer <JWT>`

Notes:
- Meal types: `breakfast | lunch | snacks | dinner`
- Meal status: `open | holiday`

---

## Health

### `GET /`
**Request**: none  
**Response 200**
```json
{ "ok": true, "message": "Backend is running" }
```

### `GET /ping`
**Request**: none  
**Response 200**
```json
{ "ok": true, "message": "pong" }
```

---

## Auth (OTP)

### `POST /auth/send-otp`
**Request body**
```json
{ "email": "user@example.com" }
```

**Response 200**
```json
{ "success": true, "message": "OTP sent to email" }
```

**Response 200 (dev fallback when email delivery fails)**
```json
{
  "success": true,
  "message": "OTP generated (email delivery unavailable on this network)",
  "otp": "123456",
  "emailDelivery": "failed",
  "details": "OTP email timeout"
}
```

**Errors**
- `400` `{"error":"Email required"}`
- `404` `{"error":"User not found"}`
- `403` `{"error":"User is inactive"}`
- `500` `{"error":"Failed to send OTP","details":"..."}`

### `POST /auth/verify-otp`
**Request body**
```json
{ "email": "user@example.com", "otp": "123456" }
```

**Response 200**
```json
{ "success": true, "message": "OTP verified", "token": "<JWT>" }
```

**Errors**
- `400` `{"error":"Email and OTP required"}`
- `401` `{"error":"Invalid or expired OTP"}`
- `404` `{"error":"User not found"}`
- `403` `{"error":"User is inactive"}`
- `500` `{"error":"Failed to verify OTP","details":"..."}`

### `POST /auth/save-details`
Updates an existing student profile (and optionally sets current hostel assignment).

**Request body**
```json
{
  "name": "Student Name",
  "email": "student@example.com",
  "phone": "9999999999",
  "roll_no": "R123",
  "room_no": "A-101",
  "college_id": 1,
  "hostel_id": 1
}
```

**Response 200**
```json
{ "success": true, "message": "User details saved", "token": "<JWT>" }
```

**Errors**
- `400` `{"error":"name (or username) and email are required"}`
- `404` `{"error":"User not found"}`
- `403` `{"error":"User is inactive"}`
- `500` `{"error":"Failed to save user details","details":"..."}`

---

## Student APIs (`/user`) (Auth Required)

### `GET /user/pgs`
Lists hostels (legacy route name kept).

**Query params (optional)**
- `college_id`

**Response 200**
```json
{
  "success": true,
  "hostels": [
    { "id": 1, "hostel_code": "H1", "name": "Hostel 1", "address": "Campus", "college_id": 1 }
  ]
}
```

### `PUT /user/update-details`
Updates the authenticated user.

**Request body (any subset)**
```json
{ "name": "New Name", "phone": "9999999999", "roll_no": "R123", "room_no": "A-101", "device_token": "expo-token" }
```

**Response 200**
```json
{ "success": true, "user": { "id": 1, "email": "student@example.com", "role": "student", "...": "..." } }
```

**Errors**
- `400` `{"error":"No fields to update"}`
- `401` `{"error":"Unauthorized"}`

### `POST /user/saveDeviceToken`
**Request body**
```json
{ "deviceToken": "expo-token" }
```

**Response 200**
```json
{ "success": true, "message": "Device token updated", "user": { "...": "..." } }
```

### `POST /user/enroll`
Sets the student’s current hostel assignment.

**Request body**
```json
{ "hostel_id": 1 }
```

**Response 200**
```json
{ "success": true, "message": "Hostel enrollment saved", "hostel_id": 1 }
```

### `GET /user/qrcode`
Generates a QR code containing student identity (payload includes `user_id`, `email`, and current `hostel_id` if assigned).

**Response 200**
```json
{
  "qr": "data:image/png;base64,...",
  "payload": { "user_id": 1, "email": "student@example.com", "hostel_id": 1 }
}
```

### `GET /user/assigned-meals`
Returns a 7-day window (today to today+6) of meal calendar rows for the student’s active hostel assignment.

**Response 200**
```json
{
  "hostel_id": 1,
  "from": "2025-01-01",
  "to": null,
  "meals": [
    { "date": "2025-01-01", "meal": "breakfast", "status": "open", "note": null, "items": ["Poha"] }
  ]
}
```

**Errors**
- `403` `{"error":"User not enrolled in any hostel"}`

### `GET /user/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`
Attended/missed aggregated counts by meal type.

**Response 200**
```json
{
  "from": "2025-01-01",
  "to": "2025-01-07",
  "hostel_id": 1,
  "attended": { "breakfast": 0, "lunch": 0, "snacks": 0, "dinner": 0 },
  "missed": { "breakfast": 0, "lunch": 0, "snacks": 0, "dinner": 0 }
}
```

### `GET /user/check-status`
**Response 200 (not enrolled)**
```json
{ "status": 0 }
```

**Response 200 (enrolled)**
```json
{ "status": 2, "hostel": { "id": 1, "hostel_code": "H1", "name": "Hostel 1", "address": "Campus", "college_id": 1 } }
```

---

## Menu APIs (`/meals`) (Auth Required)

### `GET /meals/menu?hostel_id=1&date=YYYY-MM-DD`

**Response 200**
```json
{
  "hostel_id": 1,
  "date": "2025-01-01",
  "meals": [
    { "hostel_id": 1, "date": "2025-01-01", "meal": "snacks", "status": "open", "note": null, "items": ["Tea"] }
  ]
}
```

### `GET /meals/template?hostel_id=1&day_of_week=1` (manager only)
Weekly defaults (day_of_week: `0=Sun ... 6=Sat`).

**Response 200**
```json
{
  "success": true,
  "hostel_id": 1,
  "templates": [
    { "hostel_id": 1, "day_of_week": 1, "meal": "breakfast", "status": "open", "note": null, "items": ["Poha"] }
  ]
}
```

### `POST /meals/template` (manager only)
Upserts weekly defaults.

**Request body**
```json
{
  "hostel_id": 1,
  "day_of_week": 1,
  "meal_type": "snacks",
  "status": "open",
  "note": "Tea at 5",
  "items": ["Tea", "Biscuits"]
}
```

**Response 200**
```json
{ "success": true, "template": { "hostel_id": 1, "day_of_week": 1, "meal": "snacks", "status": "open", "note": "Tea at 5", "items": ["Tea","Biscuits"] } }
```

### `POST /meals/override` (manager only)
Date-specific override (exceptions). Writes into `meal_calendars`.

**Request body**
```json
{
  "hostel_id": 1,
  "date": "2025-01-01",
  "meal_type": "snacks",
  "status": "open",
  "note": "Tea at 5",
  "items": ["Tea", "Biscuits"]
}
```

**Response 200**
```json
{ "success": true, "override": { "id": 1, "hostel_id": 1, "date": "2025-01-01", "meal": "snacks", "status": "open", "note": "Tea at 5", "items": ["Tea","Biscuits"] } }
```

### `POST /meals/menu` (manager only, alias)
Same as `POST /meals/override` (kept for backward compatibility).

**Request body**
```json
{
  "hostel_id": 1,
  "date": "2025-01-01",
  "meal_type": "snacks",
  "status": "open",
  "note": "Tea at 5",
  "items": ["Tea", "Biscuits"]
}
```

**Response 200**
```json
{ "success": true, "override": { "id": 1, "hostel_id": 1, "date": "2025-01-01", "meal": "snacks", "status": "open", "note": "Tea at 5", "items": ["Tea","Biscuits"] } }
```

**Errors**
- `403` `{"error":"Manager not assigned to this hostel"}`
- `400` `{"error":"status must be open or holiday"}`
- `400` `{"error":"hostel_id, date, and meal_type are required"}`

### `DELETE /meals/menu/item` (manager only)
**Request body**
```json
{ "hostel_id": 1, "date": "2025-01-01", "meal_type": "snacks", "item": "Tea" }
```

**Response 200**
```json
{ "success": true, "items": ["Biscuits"] }
```

---

## Manager APIs (`/admin`)

### `POST /admin/login` (OTP-based)
**Request body**
```json
{ "email": "manager@example.com", "otp": "123456" }
```

**Response 200**
```json
{ "token": "<JWT>", "hostel_id": 1 }
```

**Errors**
- `401` `{"error":"Invalid or expired OTP"}`
- `403` `{"error":"Not a manager account"}`
- `403` `{"error":"Manager not assigned to any hostel"}`

### `POST /admin/mark-attendance` (auth)
Marks attendance for **today (IST)**.

**Request body**
```json
{ "email": "student@example.com", "meal_type": "snacks", "source": "qr" }
```

**Response 200**
```json
{ "message": "Attendance marked" }
```

**Errors**
- `403` `{"error":"Student not enrolled in this hostel"}`
- `409` `{"error":"Meal is marked as holiday"}`
- `409` `{"message":"Attendance already marked"}`

### `GET /admin/qr-scans/today` (auth)
**Response 200**
```json
{
  "date": "2025-01-01",
  "hostel_id": 1,
  "total": 0,
  "breakdown": [{ "meal": "snacks", "count": 0 }]
}
```

### `GET /admin/qr-scans/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` (auth)
**Response 200**
```json
{
  "from": "2025-01-01",
  "to": "2025-01-07",
  "hostel_id": 1,
  "total": 0,
  "byDate": [
    { "date": "2025-01-01", "total": 0, "breakdown": { "snacks": 0 } }
  ]
}
```

### `GET /admin/qr-scans/details?date=YYYY-MM-DD&meal_type=snacks` (auth)
**Response 200**
```json
{
  "date": "2025-01-01",
  "meal": "snacks",
  "hostel_id": 1,
  "attendees": [
    { "email": "student@example.com", "name": "Student Name", "phone": "9999999999", "scanned_at": "2025-01-01T12:00:00.000Z" }
  ]
}
```
