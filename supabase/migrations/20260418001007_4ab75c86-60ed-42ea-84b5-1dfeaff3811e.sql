
-- 1. Extend platform_settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS customer_base_fee numeric NOT NULL DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS customer_per_km_fee numeric NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS peak_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS peak_start_hour integer NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS peak_end_hour integer NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS peak_weekdays integer[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  ADD COLUMN IF NOT EXISTS bike_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS motorcycle_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS car_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS default_commission_pct numeric NOT NULL DEFAULT 15.0;

-- 2. Per-store pricing overrides
CREATE TABLE IF NOT EXISTS public.store_pricing_overrides (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  base_pay numeric,
  per_km_rate numeric,
  min_pay numeric,
  commission_pct numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_pricing_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can view overrides" ON public.store_pricing_overrides;
CREATE POLICY "Anyone authenticated can view overrides"
  ON public.store_pricing_overrides FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage store overrides" ON public.store_pricing_overrides;
CREATE POLICY "Admins can manage store overrides"
  ON public.store_pricing_overrides FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Suspension reasons
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- 4. Wallet adjustment RPC
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_driver_id uuid, p_amount numeric, p_description text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can adjust wallets';
  END IF;
  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
  ON CONFLICT (driver_id) DO NOTHING;
  UPDATE public.driver_wallets
  SET available_balance = available_balance + p_amount
  WHERE driver_id = p_driver_id;
  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id,
    CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END,
    p_amount, 'completed', COALESCE(p_description, 'Admin adjustment'));
END;
$$;

-- 5. Auto-create earning on delivery
CREATE OR REPLACE FUNCTION public.auto_create_earning_on_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric; v_tip numeric; v_total_base numeric;
  v_vehicle_type text;
  v_vehicle_mult numeric := 1.0;
  v_peak_mult numeric := 1.0;
  v_dow integer; v_hour integer;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM earnings WHERE order_id = NEW.id AND driver_id = NEW.driver_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = NEW.store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(NEW.distance_km, 0);
  v_tip    := COALESCE(NEW.tip_amount, 0);

  SELECT vehicle_type INTO v_vehicle_type FROM driver_profiles WHERE user_id = NEW.driver_id;
  IF v_vehicle_type = 'bike' THEN
    v_vehicle_mult := COALESCE(v_settings.bike_multiplier, 1.0);
  ELSIF v_vehicle_type = 'car' THEN
    v_vehicle_mult := COALESCE(v_settings.car_multiplier, 1.0);
  ELSE
    v_vehicle_mult := COALESCE(v_settings.motorcycle_multiplier, 1.0);
  END IF;

  v_dow  := EXTRACT(ISODOW FROM now())::int;
  v_hour := EXTRACT(HOUR   FROM now())::int;
  IF v_dow = ANY(COALESCE(v_settings.peak_weekdays, ARRAY[1,2,3,4,5,6,7]))
     AND v_hour >= COALESCE(v_settings.peak_start_hour, 19)
     AND v_hour <  COALESCE(v_settings.peak_end_hour, 22) THEN
    v_peak_mult := COALESCE(v_settings.peak_multiplier, 1.0);
  END IF;

  v_total_base := GREATEST(v_min, v_base + v_per_km * v_km) * v_vehicle_mult * v_peak_mult;

  -- 'total' is generated; do not insert it
  INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus)
  VALUES (NEW.driver_id, NEW.id, v_total_base, v_tip, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_earning_on_delivery ON public.orders;
CREATE TRIGGER trg_auto_earning_on_delivery
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.auto_create_earning_on_delivery();

DROP TRIGGER IF EXISTS trg_credit_wallet_on_earning ON public.earnings;
CREATE TRIGGER trg_credit_wallet_on_earning
AFTER INSERT ON public.earnings
FOR EACH ROW EXECUTE FUNCTION public.credit_wallet_on_earning();

-- 6. Backfill missing earnings for past delivered orders
DO $$
DECLARE r record;
DECLARE s platform_settings%ROWTYPE;
DECLARE ov store_pricing_overrides%ROWTYPE;
DECLARE base_p numeric; per_km numeric; min_p numeric;
DECLARE km numeric; tip numeric; total_base numeric;
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;
  FOR r IN
    SELECT o.id, o.driver_id, o.store_id, o.distance_km, o.tip_amount
    FROM orders o
    WHERE o.status = 'delivered'
      AND o.driver_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM earnings e WHERE e.order_id = o.id)
  LOOP
    SELECT * INTO ov FROM store_pricing_overrides WHERE store_id = r.store_id;
    base_p := COALESCE(ov.base_pay,    s.base_pay,    3);
    per_km := COALESCE(ov.per_km_rate, s.per_km_rate, 0.5);
    min_p  := COALESCE(ov.min_pay,     s.min_pay,     3);
    km  := COALESCE(r.distance_km, 0);
    tip := COALESCE(r.tip_amount, 0);
    total_base := GREATEST(min_p, base_p + per_km * km);
    INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus)
    VALUES (r.driver_id, r.id, total_base, tip, 0);
  END LOOP;
END $$;
