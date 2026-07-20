ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS dispatch_lead_minutes integer NOT NULL DEFAULT 8;