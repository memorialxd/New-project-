ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS show_stores_on_driver_map boolean NOT NULL DEFAULT true;