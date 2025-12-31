# Manual Test Checklist (curl)

Set:
- `BASE=http://localhost:3000`

## Verify `/user/stats` (eligible vs attended vs missed)

The backend computes:
- `attended` = scans in `attendance_scans` for the user within `[from,to]` (capped to today IST)
- `eligible` = menu service days within `[from,to]` for the user’s assigned hostel, using `override > weekly template > default open`
- `missed` = `max(eligible - attended, 0)` per meal type

### DB check (eligible vs attended) for Akshit (user_id=3)
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
WITH params AS (
  SELECT '2025-12-02'::date AS from_date, '2025-12-31'::date AS to_date, 3::bigint AS user_id
),
days AS (
  SELECT d::date AS date, EXTRACT(DOW FROM d)::int AS dow
  FROM params, generate_series(from_date, to_date, INTERVAL '1 day') d
),
assigned AS (
  SELECT days.date, days.dow,
         (
           SELECT hostel_id
           FROM user_hostel_assignments
           WHERE user_id = (SELECT user_id FROM params)
             AND start_date <= days.date
             AND (end_date IS NULL OR end_date >= days.date)
           ORDER BY start_date DESC
           LIMIT 1
         ) AS hostel_id
  FROM days
),
assigned_days AS (
  SELECT * FROM assigned WHERE hostel_id IS NOT NULL
),
meal_types AS (
  SELECT * FROM (VALUES ('breakfast'::text), ('lunch'::text), ('snacks'::text), ('dinner'::text)) AS t(meal)
),
merged AS (
  SELECT ad.date, ad.hostel_id, mt.meal,
         COALESCE(mc.status, twm.status, 'open') AS status
  FROM assigned_days ad
  CROSS JOIN meal_types mt
  LEFT JOIN meal_calendars mc
    ON mc.hostel_id = ad.hostel_id AND mc.date = ad.date AND mc.meal = mt.meal
  LEFT JOIN hostel_weekly_menus twm
    ON twm.hostel_id = ad.hostel_id AND twm.day_of_week = ad.dow AND twm.meal = mt.meal
),
eligible AS (
  SELECT meal, SUM((status='open')::int)::int AS eligible
  FROM merged
  GROUP BY meal
),
attended AS (
  SELECT a.meal, COUNT(*)::int AS attended
  FROM attendance_scans a
  JOIN assigned_days ad ON ad.date = a.date AND ad.hostel_id = a.hostel_id
  WHERE a.user_id = (SELECT user_id FROM params)
    AND a.date >= (SELECT from_date FROM params)
    AND a.date <= (SELECT to_date FROM params)
  GROUP BY a.meal
)
SELECT mt.meal,
       COALESCE(eligible.eligible,0) AS eligible,
       COALESCE(attended.attended,0) AS attended,
       GREATEST(COALESCE(eligible.eligible,0) - COALESCE(attended.attended,0), 0) AS missed
FROM meal_types mt
LEFT JOIN eligible USING (meal)
LEFT JOIN attended USING (meal)
ORDER BY mt.meal;
"
```

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
