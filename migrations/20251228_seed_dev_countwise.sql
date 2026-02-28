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

-- 2c) Hostel 2
INSERT INTO hostels (college_id, hostel_code, name, address, is_active)
SELECT c.id, 'H2', 'Hostel 2', 'Campus', true
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

-- 6) Weekly menu template for H1 + H2
WITH hostels_to_seed AS (
  SELECT id AS hostel_id
  FROM hostels
  WHERE hostel_code IN ('H1', 'H2')
),
template_rows AS (
  SELECT *
  FROM (
    VALUES
      -- day_of_week: 0=Sun ... 6=Sat
      (0, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Uttapam / masala dosa','sambar','coconut chutney','milk','tea','coffee','bread-butter','mixed sprouts','banana'])),
      (0, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Shahi paneer','dal makhani','boondi raita','veg pulao','puri/chapati','salad','pickle','cold drink','ice cream'])),
      (0, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Poha namkeen','tea/coffee'])),
      (0, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Aloo matar / gajar matar / aloo gobhi','arhar dal tadka','rice','puri/chapati','onion','pickle','sevai kheer'])),

      (1, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Poha','Namkeen','chopped onion + tomato + lemon','milk','tea','coffee','bread-butter','mixed sprouts'])),
      (1, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Rajma','potato-onion-tomato sabzi','curd','rice','puri/chapati','salad','papad','lemon pickle'])),
      (1, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Samosa / Dal Kachori with chutney','tea/coffee'])),
      (1, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Bhindi / seasonal veg sabzi','dal tadka','rice','chapati','papad','pickle','sweet'])),

      (2, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Upma','milk','tea','coffee','bread-butter','mixed sprouts','sev'])),
      (2, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Besan gatta curry','mix dal','namkeen rice','curd','puri/chapati','salad','papad','pickle'])),
      (2, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Maggi','tea/coffee'])),
      (2, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Aloo matar','kala chana','puri','kheer','onion salad','pickle'])),

      (3, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Aloo bread sandwich','omelette','milk','tea','coffee','bread-butter','mixed sprouts','banana'])),
      (3, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Kadhi pakoda','aloo chhola','rice','puri/chapati','papad','salad','lemon pickle'])),
      (3, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Upma','tea/coffee'])),
      (3, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Kadhi pakoda','gatte ki sabzi','rice','puri/chapati','chutney','pickle','custard'])),

      (4, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Idli','sambar','coconut chutney','milk','tea','coffee','bread-butter','mixed sprouts','seasonal fruit'])),
      (4, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Malai kofta','dal fry','rice','curd','puri/chapati','salad'])),
      (4, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Poha / mixed pakodi','tea/coffee'])),
      (4, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Mixed veg','dal fry','jeera rice','puri/chapati','onion','papad','halwa'])),

      (5, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Pav bhaji / chole kulche','chopped onion','lemon','milk','tea','coffee','bread-butter','mixed sprouts','seasonal fruit'])),
      (5, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Lauki chana dal / sev tamatar / patta gobhi','dal mix','plain rice','chapati','salad','pickle'])),
      (5, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Veg sandwich','tea/coffee'])),
      (5, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Shahi paneer','arhar dal','jeera rice','puri/chapati','onion','pickle'])),

      (6, 'breakfast', 'open', NULL::text, to_jsonb(ARRAY['Aloo/onion/methi paratha','curd','milk','tea','coffee','bread-butter','mixed sprouts','banana'])),
      (6, 'lunch',     'open', NULL::text, to_jsonb(ARRAY['Aloo soyabean / aloo palak','dal mung','plain rice','puri/chapati','curd','salad','pickle'])),
      (6, 'snacks',    'open', NULL::text, to_jsonb(ARRAY['Bhelpuri / chana masala','tea/coffee'])),
      (6, 'dinner',    'open', NULL::text, to_jsonb(ARRAY['Chola','methi','onion veg pulao','lemon','pickle','garlic chutney','green chilli']))
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
