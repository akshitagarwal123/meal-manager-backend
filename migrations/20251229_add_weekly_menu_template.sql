-- Weekly menu template per hostel (day-of-week + meal).
-- day_of_week uses Postgres convention: 0=Sunday ... 6=Saturday (extract(dow from date)).

BEGIN;

CREATE TABLE IF NOT EXISTS public.hostel_weekly_menus (
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

CREATE INDEX IF NOT EXISTS idx_hostel_weekly_menus_hostel_dow ON public.hostel_weekly_menus (hostel_id, day_of_week);

COMMIT;

