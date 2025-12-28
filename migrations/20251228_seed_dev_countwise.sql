-- Dev seed for Count Wise schema (safe to re-run).

BEGIN;

-- 1) College
INSERT INTO colleges (code, name, city, state, timezone)
VALUES ('MNIT', 'MNIT', 'Jaipur', 'Rajasthan', 'Asia/Kolkata')
ON CONFLICT (code) DO NOTHING;

-- 2) Hostel
INSERT INTO hostels (college_id, hostel_code, name, address, is_active)
SELECT c.id, 'H1', 'Hostel 1', 'Campus', true
FROM colleges c
WHERE c.code = 'MNIT'
ON CONFLICT (college_id, hostel_code) DO NOTHING;

-- 2b) Additional hostel for dev/mock data
INSERT INTO hostels (college_id, hostel_code, name, address, is_active)
SELECT c.id, 'AUROBINDO', 'Aurobindo', 'Campus', true
FROM colleges c
WHERE c.code = 'MNIT'
ON CONFLICT (college_id, hostel_code)
DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  is_active = EXCLUDED.is_active;

-- 3) Manager user (change email/phone as you like)
INSERT INTO users (college_id, name, email, phone, role, is_active)
SELECT c.id, 'Mess Manager', 'manager@example.com', '9999999999', 'manager', true
FROM colleges c
WHERE c.code = 'MNIT'
ON CONFLICT (email) DO NOTHING;

-- 3b) Student mock user (based on provided sample)
-- AUROBINDO H9/A/1/101/B1 2022UCE1102 (name updated) 7505170242
INSERT INTO users (college_id, name, email, phone, role, roll_no, room_no, is_active)
SELECT c.id,
       'Akshit Agarwal',
       'akshitagarwal431@gmail.com',
       '7505170242',
       'student',
       '2022UCE1102',
       'H9/A/1/101/B1',
       true
FROM colleges c
WHERE c.code = 'MNIT'
ON CONFLICT (email)
DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  roll_no = EXCLUDED.roll_no,
  room_no = EXCLUDED.room_no,
  is_active = EXCLUDED.is_active;

-- 4) Assign manager to hostel
INSERT INTO hostel_staff (user_id, hostel_id, role, start_date)
SELECT u.id, h.id, 'manager', CURRENT_DATE
FROM users u
JOIN hostels h ON true
WHERE u.email = 'manager@example.com'
  AND h.hostel_code = 'H1'
ON CONFLICT DO NOTHING;

-- 4b) Assign student to hostel (active assignment)
INSERT INTO user_hostel_assignments (user_id, hostel_id, start_date, reason)
SELECT u.id, h.id, CURRENT_DATE, 'dev seed'
FROM users u
JOIN hostels h ON true
WHERE u.email = 'akshitagarwal431@gmail.com'
  AND h.hostel_code = 'AUROBINDO'
  AND NOT EXISTS (
    SELECT 1
    FROM user_hostel_assignments a
    WHERE a.user_id = u.id
      AND a.hostel_id = h.id
      AND a.end_date IS NULL
  );

-- 5) Meal windows defaults
INSERT INTO hostel_meal_windows (hostel_id, meal, start_time, end_time, grace_minutes)
SELECT h.id, 'breakfast', '07:00', '10:00', 10 FROM hostels h WHERE h.hostel_code = 'H1'
ON CONFLICT (hostel_id, meal) DO NOTHING;
INSERT INTO hostel_meal_windows (hostel_id, meal, start_time, end_time, grace_minutes)
SELECT h.id, 'lunch', '12:00', '15:00', 10 FROM hostels h WHERE h.hostel_code = 'H1'
ON CONFLICT (hostel_id, meal) DO NOTHING;
INSERT INTO hostel_meal_windows (hostel_id, meal, start_time, end_time, grace_minutes)
SELECT h.id, 'snacks', '16:30', '18:30', 10 FROM hostels h WHERE h.hostel_code = 'H1'
ON CONFLICT (hostel_id, meal) DO NOTHING;
INSERT INTO hostel_meal_windows (hostel_id, meal, start_time, end_time, grace_minutes)
SELECT h.id, 'dinner', '19:30', '22:30', 10 FROM hostels h WHERE h.hostel_code = 'H1'
ON CONFLICT (hostel_id, meal) DO NOTHING;

-- 6) Weekly menu template (mock defaults) for H1 + AUROBINDO
WITH hostels_to_seed AS (
  SELECT id AS hostel_id
  FROM hostels
  WHERE hostel_code IN ('H1', 'AUROBINDO')
),
template_rows AS (
  SELECT *
  FROM (
    VALUES
      -- day_of_week: 0=Sun ... 6=Sat
      (0, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Poha','Tea'])),
      (0, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Dal','Rice','Salad'])),
      (0, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Samosa','Chai'])),
      (0, 'dinner',    'holiday', 'Mess closed', to_jsonb(ARRAY[]::text[])),

      (1, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Aloo Paratha','Curd'])),
      (1, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Rajma','Rice','Salad'])),
      (1, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Bread Pakoda','Chai'])),
      (1, 'dinner',    'open',   NULL::text, to_jsonb(ARRAY['Roti','Paneer Bhurji','Dal'])),

      (2, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Idli','Sambar'])),
      (2, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Chole','Rice','Salad'])),
      (2, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Bhel','Tea'])),
      (2, 'dinner',    'open',   NULL::text, to_jsonb(ARRAY['Roti','Mix Veg','Dal'])),

      (3, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Upma','Tea'])),
      (3, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Kadhi','Rice','Salad'])),
      (3, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Maggi','Tea'])),
      (3, 'dinner',    'open',   NULL::text, to_jsonb(ARRAY['Roti','Chicken Curry','Salad'])),

      (4, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Dosa','Chutney'])),
      (4, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Aloo Matar','Rice','Salad'])),
      (4, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Kachori','Chai'])),
      (4, 'dinner',    'open',   NULL::text, to_jsonb(ARRAY['Roti','Dal Fry','Jeera Rice'])),

      (5, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Chole Bhature'])),
      (5, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Dal Makhani','Rice','Salad'])),
      (5, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Pasta','Tea'])),
      (5, 'dinner',    'open',   NULL::text, to_jsonb(ARRAY['Roti','Shahi Paneer','Dal'])),

      (6, 'breakfast', 'open',   NULL::text, to_jsonb(ARRAY['Puri','Aloo Sabzi'])),
      (6, 'lunch',     'open',   NULL::text, to_jsonb(ARRAY['Veg Biryani','Raita'])),
      (6, 'snacks',    'open',   NULL::text, to_jsonb(ARRAY['Sandwich','Tea'])),
      (6, 'dinner',    'open',   NULL::text, to_jsonb(ARRAY['Roti','Seasonal Veg','Dal']))
  ) AS t(day_of_week, meal, status, note, items)
)
INSERT INTO hostel_weekly_menus (hostel_id, day_of_week, meal, status, note, items)
SELECT h.hostel_id, r.day_of_week, r.meal, r.status, r.note, r.items
FROM hostels_to_seed h
CROSS JOIN template_rows r
ON CONFLICT (hostel_id, day_of_week, meal)
DO UPDATE SET
  status = EXCLUDED.status,
  note = EXCLUDED.note,
  items = EXCLUDED.items,
  updated_at = now();

COMMIT;
