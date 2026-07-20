
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS accept_offer_requires_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_arrive_before_pickup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_deliver_before_arrive boolean NOT NULL DEFAULT false;
