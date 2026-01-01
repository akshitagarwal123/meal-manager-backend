-- Single-device login support: bump token_version on new student login to invalidate older JWTs.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

