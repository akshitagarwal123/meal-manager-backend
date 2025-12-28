-- Reset current schema and create Count Wise app schema.
-- WARNING: This drops ALL tables in the `public` schema (data loss).

BEGIN;

-- Drop all tables in public schema (keeps extensions).
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE;', rec.tablename);
  END LOOP;
END $$;

-- Core tables
CREATE TABLE public.colleges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.hostels (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  hostel_code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT hostels_college_hostel_code_unique UNIQUE (college_id, hostel_code)
);

CREATE TABLE public.users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT REFERENCES public.colleges(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  roll_no TEXT,
  room_no TEXT,
  device_token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('student', 'manager'))
);

CREATE INDEX idx_users_college_id ON public.users (college_id);
CREATE INDEX idx_users_role ON public.users (role);

CREATE TABLE public.audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT REFERENCES public.colleges(id) ON DELETE SET NULL,
  actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_college_created ON public.audit_logs (college_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor_created ON public.audit_logs (actor_user_id, created_at DESC);

-- Hostel config
CREATE TABLE public.hostel_meal_windows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  meal TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT hostel_meal_windows_meal_check CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  CONSTRAINT hostel_meal_windows_unique UNIQUE (hostel_id, meal)
);

CREATE TABLE public.meal_calendars (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT meal_calendars_meal_check CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  CONSTRAINT meal_calendars_status_check CHECK (status IN ('open', 'holiday')),
  CONSTRAINT meal_calendars_unique UNIQUE (hostel_id, date, meal)
);

CREATE INDEX idx_meal_calendars_hostel_date ON public.meal_calendars (hostel_id, date);

-- Weekly menu template (defaults) per hostel (day-of-week + meal).
-- day_of_week: 0=Sunday ... 6=Saturday (Postgres extract(dow from date)).
CREATE TABLE public.hostel_weekly_menus (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL,
  meal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT hostel_weekly_menus_dow_check CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT hostel_weekly_menus_meal_check CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  CONSTRAINT hostel_weekly_menus_status_check CHECK (status IN ('open', 'holiday')),
  CONSTRAINT hostel_weekly_menus_unique UNIQUE (hostel_id, day_of_week, meal)
);

CREATE INDEX idx_hostel_weekly_menus_hostel_dow ON public.hostel_weekly_menus (hostel_id, day_of_week);

-- User <-> hostel membership (student residency)
CREATE TABLE public.user_hostel_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  reason TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_hostel_assignments_user ON public.user_hostel_assignments (user_id, start_date DESC);
CREATE INDEX idx_user_hostel_assignments_hostel ON public.user_hostel_assignments (hostel_id, start_date DESC);

-- Manager/staff assignment to a hostel
CREATE TABLE public.hostel_staff (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'manager',
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT hostel_staff_role_check CHECK (role IN ('manager')),
  CONSTRAINT hostel_staff_unique UNIQUE (user_id, hostel_id, role, start_date)
);

CREATE INDEX idx_hostel_staff_hostel ON public.hostel_staff (hostel_id, start_date DESC);

-- Attendance scans (QR scans)
CREATE TABLE public.attendance_scans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal TEXT NOT NULL,
  scanned_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  scanned_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  source TEXT,
  CONSTRAINT attendance_scans_meal_check CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  CONSTRAINT attendance_scans_dedupe UNIQUE (hostel_id, date, meal, user_id)
);

CREATE INDEX idx_attendance_scans_hostel_date ON public.attendance_scans (hostel_id, date);
CREATE INDEX idx_attendance_scans_user_date ON public.attendance_scans (user_id, date);

-- Entitlement freezes (opt-out windows)
CREATE TABLE public.entitlement_freezes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hostel_id BIGINT NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT,
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_freezes_date_check CHECK (to_date >= from_date)
);

CREATE INDEX idx_entitlement_freezes_user ON public.entitlement_freezes (user_id, from_date, to_date);
CREATE INDEX idx_entitlement_freezes_hostel ON public.entitlement_freezes (hostel_id, from_date, to_date);

COMMIT;
