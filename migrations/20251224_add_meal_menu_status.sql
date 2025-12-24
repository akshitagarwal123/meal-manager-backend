-- Adds holiday support to meal menus.
ALTER TABLE meal_menus
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Backfill existing rows.
UPDATE meal_menus SET status = COALESCE(status, 'open');
