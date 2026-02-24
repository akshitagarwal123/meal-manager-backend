BEGIN;

ALTER TABLE public.hostels
  ADD COLUMN IF NOT EXISTS mess_no TEXT;

CREATE INDEX IF NOT EXISTS idx_hostels_mess_no
  ON public.hostels (mess_no);

COMMIT;
