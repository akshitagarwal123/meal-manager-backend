-- Preserve attendance and assignment records when a user is permanently deleted.
-- Change user_id foreign keys from CASCADE to SET NULL and allow NULLs.

BEGIN;

-- attendance_scans: keep scan records, null out user_id
ALTER TABLE public.attendance_scans
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.attendance_scans
  DROP CONSTRAINT IF EXISTS attendance_scans_user_id_fkey;

ALTER TABLE public.attendance_scans
  ADD CONSTRAINT attendance_scans_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- user_hostel_assignments: keep assignment history, null out user_id
ALTER TABLE public.user_hostel_assignments
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.user_hostel_assignments
  DROP CONSTRAINT IF EXISTS user_hostel_assignments_user_id_fkey;

ALTER TABLE public.user_hostel_assignments
  ADD CONSTRAINT user_hostel_assignments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- hostel_staff: keep staff history, null out user_id
ALTER TABLE public.hostel_staff
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.hostel_staff
  DROP CONSTRAINT IF EXISTS hostel_staff_user_id_fkey;

ALTER TABLE public.hostel_staff
  ADD CONSTRAINT hostel_staff_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- entitlement_freezes: keep freeze records, null out user_id
ALTER TABLE public.entitlement_freezes
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.entitlement_freezes
  DROP CONSTRAINT IF EXISTS entitlement_freezes_user_id_fkey;

ALTER TABLE public.entitlement_freezes
  ADD CONSTRAINT entitlement_freezes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;
