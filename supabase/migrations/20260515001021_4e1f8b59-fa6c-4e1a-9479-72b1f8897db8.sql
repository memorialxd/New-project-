ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_dispatch_enabled boolean NOT NULL DEFAULT true;