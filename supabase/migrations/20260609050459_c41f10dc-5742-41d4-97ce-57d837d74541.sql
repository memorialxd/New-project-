ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_target_audience_check;
ALTER TABLE public.announcements ADD CONSTRAINT announcements_target_audience_check
  CHECK (target_audience = ANY (ARRAY['drivers','store_owners','support','admin','all']));