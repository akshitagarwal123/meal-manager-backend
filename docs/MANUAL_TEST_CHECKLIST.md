# Manual Test Checklist (curl)

Set:
- `BASE=http://localhost:3000`

## Health
- `curl -sS $BASE/ping`

## Student auth (OTP)
- Send OTP: `curl -sS -X POST $BASE/auth/send-otp -H 'Content-Type: application/json' -d '{"email":"student@example.com"}'`
- Verify OTP (use returned `otp` only if dev fallback is enabled): `curl -sS -X POST $BASE/auth/verify-otp -H 'Content-Type: application/json' -d '{"email":"student@example.com","otp":"123456"}'`
- Save profile (returns token): `curl -sS -X POST $BASE/auth/save-details -H 'Content-Type: application/json' -d '{"name":"Student","email":"student@example.com","phone":"9999999999","room_no":"A-101","roll_no":"R123","college_id":1,"hostel_id":1}'`

Export:
- `STUDENT_TOKEN=<token from save-details>`

## Student endpoints
- Update profile: `curl -sS -X PUT $BASE/user/update-details -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' -d '{"college":"My College","room_no":"A-102"}'`
- QR: `curl -sS $BASE/user/qrcode -H "Authorization: Bearer $STUDENT_TOKEN"`
- Enroll hostel: `curl -sS -X POST $BASE/user/enroll -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' -d '{"hostel_id":1}'`
- Assigned meals: `curl -sS $BASE/user/assigned-meals -H "Authorization: Bearer $STUDENT_TOKEN"`
- Menu for date: `curl -sS "$BASE/meals/menu?hostel_id=1&date=2025-01-01" -H "Authorization: Bearer $STUDENT_TOKEN"`
- Stats: `curl -sS "$BASE/user/stats?from=2025-01-01&to=2025-01-07" -H "Authorization: Bearer $STUDENT_TOKEN"`

## Manager login (OTP-based)
- Send OTP: `curl -sS -X POST $BASE/auth/send-otp -H 'Content-Type: application/json' -d '{"email":"manager@example.com"}'`
- Login: `curl -sS -X POST $BASE/admin/login -H 'Content-Type: application/json' -d '{"email":"manager@example.com","otp":"123456"}'`

Export:
- `MANAGER_TOKEN=<token from admin/login>`

## Manager menu management
- Create/update menu: `curl -sS -X POST $BASE/meals/menu -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d '{"hostel_id":1,"date":"2025-01-01","meal_type":"snacks","status":"open","note":"Tea at 5","items":["Tea","Biscuits"]}'`
- Mark holiday: `curl -sS -X POST $BASE/meals/menu -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d '{"hostel_id":1,"date":"2025-01-01","meal_type":"dinner","status":"holiday","note":"Festival","items":[]}'`

## Manager attendance (today IST)
- Mark attendance: `curl -sS -X POST $BASE/admin/mark-attendance -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d '{"email":"student@example.com","meal_type":"snacks"}'`
- Mark again (should 409): same command
- Today totals: `curl -sS $BASE/admin/qr-scans/today -H "Authorization: Bearer $MANAGER_TOKEN"`
- Summary: `curl -sS "$BASE/admin/qr-scans/summary?from=2025-01-01&to=2025-01-07" -H "Authorization: Bearer $MANAGER_TOKEN"`
- Details: `curl -sS "$BASE/admin/qr-scans/details?date=2025-01-01&meal_type=snacks" -H "Authorization: Bearer $MANAGER_TOKEN"`
