
-- ΑΑΔΕ compliance for delivery platforms (Ν.5073/2023 + myDATA)

-- 1) Platform-level config (singleton)
CREATE TABLE IF NOT EXISTS public.aade_platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Νόμιμη υπόσταση πλατφόρμας
  legal_name text,
  trade_name text,
  afm text,
  doy text,
  kad text,
  legal_address text,
  legal_city text,
  legal_postal_code text,
  representative_name text,
  representative_afm text,
  iban text,
  -- myDATA / ΑΑΔΕ API credentials
  mydata_environment text NOT NULL DEFAULT 'production' CHECK (mydata_environment IN ('production','sandbox')),
  mydata_user_id text,
  mydata_subscription_key text,
  mydata_base_url text DEFAULT 'https://mydatapi.aade.gr/myDATA',
  -- Πλατφόρμα Οικ. Δραστηριότητας (Ν.5073/2023)
  platform_registration_number text,
  platform_reporting_enabled boolean NOT NULL DEFAULT false,
  -- meta
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aade_platform_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read aade config" ON public.aade_platform_config
  FOR SELECT USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins write aade config" ON public.aade_platform_config
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2) Store tax fields (required to report)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS afm text,
  ADD COLUMN IF NOT EXISTS doy text,
  ADD COLUMN IF NOT EXISTS kad text,
  ADD COLUMN IF NOT EXISTS legal_name text;

-- 3) Driver tax fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS afm text,
  ADD COLUMN IF NOT EXISTS amka text,
  ADD COLUMN IF NOT EXISTS efka_ama text,
  ADD COLUMN IF NOT EXISTS contract_type text;

-- 4) Per-delivery report log
CREATE TABLE IF NOT EXISTS public.aade_delivery_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  store_afm text,
  driver_afm text,
  order_number text,
  delivery_at timestamptz,
  net_amount numeric(12,2),
  vat_amount numeric(12,2),
  gross_amount numeric(12,2),
  platform_commission numeric(12,2),
  driver_payout numeric(12,2),
  payment_method text,
  pickup_address text,
  dropoff_address text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','accepted','rejected','error')),
  mydata_mark text,
  mydata_uid text,
  error_message text,
  payload jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aade_reports_order ON public.aade_delivery_reports(order_id);
CREATE INDEX IF NOT EXISTS idx_aade_reports_status ON public.aade_delivery_reports(status);
CREATE INDEX IF NOT EXISTS idx_aade_reports_delivery_at ON public.aade_delivery_reports(delivery_at DESC);

ALTER TABLE public.aade_delivery_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read aade reports" ON public.aade_delivery_reports
  FOR SELECT USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage aade reports" ON public.aade_delivery_reports
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at triggers
CREATE TRIGGER trg_aade_config_updated BEFORE UPDATE ON public.aade_platform_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aade_reports_updated BEFORE UPDATE ON public.aade_delivery_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed singleton row
INSERT INTO public.aade_platform_config (mydata_environment) VALUES ('production')
  ON CONFLICT DO NOTHING;
