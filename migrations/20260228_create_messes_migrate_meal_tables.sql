-- Migrate meal-related tables from hostel-scoped to mess-scoped.
-- Creates messes table, adds mess_id to hostels, moves hostel_meal_windows,
-- hostel_weekly_menus, and meal_calendars to reference mess_id instead of hostel_id.

BEGIN;

-- 1. Create messes table
CREATE TABLE IF NOT EXISTS public.messes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  mess_no TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT messes_college_mess_no_unique UNIQUE (college_id, mess_no)
);

-- 2. Populate messes from existing hostels.mess_no
INSERT INTO messes (college_id, mess_no, name)
SELECT DISTINCT h.college_id, h.mess_no, 'Mess ' || h.mess_no
FROM hostels h
WHERE h.mess_no IS NOT NULL
ON CONFLICT (college_id, mess_no) DO NOTHING;

-- Create synthetic mess for hostels without mess_no
INSERT INTO messes (college_id, mess_no, name)
SELECT h.college_id, 'auto_' || h.id, h.name || ' Mess'
FROM hostels h
WHERE h.mess_no IS NULL;

-- 3. Add mess_id FK to hostels and backfill
ALTER TABLE public.hostels ADD COLUMN IF NOT EXISTS mess_id BIGINT REFERENCES public.messes(id);

UPDATE hostels h
SET mess_id = m.id
FROM messes m
WHERE m.college_id = h.college_id AND m.mess_no = h.mess_no AND h.mess_no IS NOT NULL;

UPDATE hostels h
SET mess_id = m.id
FROM messes m
WHERE h.mess_no IS NULL AND m.college_id = h.college_id AND m.mess_no = 'auto_' || h.id;

ALTER TABLE public.hostels ALTER COLUMN mess_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hostels_mess_id ON public.hostels (mess_id);

-- 4. Migrate hostel_meal_windows -> mess_meal_windows
ALTER TABLE public.hostel_meal_windows ADD COLUMN IF NOT EXISTS mess_id BIGINT REFERENCES public.messes(id);

UPDATE hostel_meal_windows hmw
SET mess_id = h.mess_id
FROM hostels h
WHERE h.id = hmw.hostel_id;

ALTER TABLE public.hostel_meal_windows ALTER COLUMN mess_id SET NOT NULL;

-- Deduplicate (keep lowest id per mess_id + meal)
DELETE FROM hostel_meal_windows a
USING hostel_meal_windows b
WHERE a.mess_id = b.mess_id AND a.meal = b.meal AND a.id > b.id;

-- Drop old constraint/column, add new
ALTER TABLE public.hostel_meal_windows DROP CONSTRAINT IF EXISTS hostel_meal_windows_unique;
ALTER TABLE public.hostel_meal_windows DROP COLUMN hostel_id;
ALTER TABLE public.hostel_meal_windows ADD CONSTRAINT mess_meal_windows_unique UNIQUE (mess_id, meal);

ALTER TABLE public.hostel_meal_windows RENAME TO mess_meal_windows;

-- 5. Migrate hostel_weekly_menus -> mess_weekly_menus
ALTER TABLE public.hostel_weekly_menus ADD COLUMN IF NOT EXISTS mess_id BIGINT REFERENCES public.messes(id);

UPDATE hostel_weekly_menus hwm
SET mess_id = h.mess_id
FROM hostels h
WHERE h.id = hwm.hostel_id;

ALTER TABLE public.hostel_weekly_menus ALTER COLUMN mess_id SET NOT NULL;

-- Deduplicate
DELETE FROM hostel_weekly_menus a
USING hostel_weekly_menus b
WHERE a.mess_id = b.mess_id AND a.day_of_week = b.day_of_week AND a.meal = b.meal AND a.id > b.id;

ALTER TABLE public.hostel_weekly_menus DROP CONSTRAINT IF EXISTS hostel_weekly_menus_unique;
DROP INDEX IF EXISTS idx_hostel_weekly_menus_hostel_dow;
ALTER TABLE public.hostel_weekly_menus DROP COLUMN hostel_id;
ALTER TABLE public.hostel_weekly_menus ADD CONSTRAINT mess_weekly_menus_unique UNIQUE (mess_id, day_of_week, meal);
CREATE INDEX idx_mess_weekly_menus_mess_dow ON public.hostel_weekly_menus (mess_id, day_of_week);

ALTER TABLE public.hostel_weekly_menus RENAME TO mess_weekly_menus;

-- 6. Migrate meal_calendars (keep name, just change scope)
ALTER TABLE public.meal_calendars ADD COLUMN IF NOT EXISTS mess_id BIGINT REFERENCES public.messes(id);

UPDATE meal_calendars mc
SET mess_id = h.mess_id
FROM hostels h
WHERE h.id = mc.hostel_id;

ALTER TABLE public.meal_calendars ALTER COLUMN mess_id SET NOT NULL;

-- Deduplicate
DELETE FROM meal_calendars a
USING meal_calendars b
WHERE a.mess_id = b.mess_id AND a.date = b.date AND a.meal = b.meal AND a.id > b.id;

ALTER TABLE public.meal_calendars DROP CONSTRAINT IF EXISTS meal_calendars_unique;
DROP INDEX IF EXISTS idx_meal_calendars_hostel_date;
ALTER TABLE public.meal_calendars DROP COLUMN hostel_id;
ALTER TABLE public.meal_calendars ADD CONSTRAINT meal_calendars_unique UNIQUE (mess_id, date, meal);
CREATE INDEX idx_meal_calendars_mess_date ON public.meal_calendars (mess_id, date);

COMMIT;
