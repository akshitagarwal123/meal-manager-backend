-- Add 'admin' to the users role CHECK constraint.

BEGIN;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'manager', 'admin'));

COMMIT;
