
-- 1. New pricing column on platform_settings + overrides
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS first_km_price numeric;

UPDATE public.platform_settings SET first_km_price = COALESCE(first_km_price, base_pay, 3) WHERE id = 1;

ALTER TABLE public.store_pricing_overrides
  ADD COLUMN IF NOT EXISTS first_km_price numeric;

-- 2. Helper: Haversine distance in km
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE r constant numeric := 6371; dlat numeric; dlon numeric; a numeric;
BEGIN
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN RETURN NULL; END IF;
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)^2;
  RETURN ROUND((r * 2 * atan2(sqrt(a), sqrt(1-a)))::numeric, 2);
END $$;

-- 3. Helper: quote driver payout with new first-km formula
CREATE OR REPLACE FUNCTION public.quote_driver_payout(p_store_id uuid, p_distance_km numeric)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  o public.store_pricing_overrides%ROWTYPE;
  v_first numeric; v_per_km numeric; v_min numeric; v_max numeric; v_km numeric; v_raw numeric;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = 1;
  SELECT * INTO o FROM public.store_pricing_overrides WHERE store_id = p_store_id;
  v_first  := COALESCE(o.first_km_price, s.first_km_price, o.base_pay, s.base_pay, 3);
  v_per_km := COALESCE(o.per_km_rate, s.per_km_rate, 0.5);
  v_min    := COALESCE(o.min_pay, s.min_pay, 3);
  v_max    := COALESCE(o.max_pay, s.max_pay, 999999);
  v_km     := COALESCE(p_distance_km, 0);
  v_raw    := v_first + v_per_km * GREATEST(v_km - 1, 0);
  RETURN ROUND(LEAST(GREATEST(v_raw, v_min), v_max)::numeric, 2);
END $$;

-- 4. Trigger: on order insert, auto-fill distance_km and driver_payout
CREATE OR REPLACE FUNCTION public.set_order_distance_and_payout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s record;
BEGIN
  IF NEW.distance_km IS NULL OR NEW.distance_km <= 0 THEN
    SELECT latitude, longitude INTO s FROM public.stores WHERE id = NEW.store_id;
    IF s.latitude IS NOT NULL AND NEW.delivery_latitude IS NOT NULL THEN
      NEW.distance_km := public.haversine_km(s.latitude, s.longitude, NEW.delivery_latitude, NEW.delivery_longitude);
    END IF;
  END IF;
  IF NEW.driver_payout IS NULL OR NEW.driver_payout = 0 THEN
    NEW.driver_payout := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_order_distance_and_payout ON public.orders;
CREATE TRIGGER trg_set_order_distance_and_payout
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_order_distance_and_payout();

-- 5. Update settle_order_commission fallback to use first-km formula
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  split jsonb; admin_amt numeric; pool_amt numeric; delivery_amt numeric;
  tip_amt numeric; store_extra numeric; store_keeps_amt numeric;
  pays_delivery boolean; pool_balance numeric;
  pool_take numeric := 0; admin_subsidy numeric := 0;
  is_cash boolean; cash_collected numeric := 0;
  driver_share_total numeric := 0; amount_owed numeric := 0;
  driver_base_pay numeric := 0; locked_payout numeric;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);
  pays_delivery   := COALESCE((split->>'store_pays_delivery')::boolean, false);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN driver_base_pay := delivery_amt; END IF;

  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury SET admin_balance = admin_balance + admin_amt,
      lifetime_admin_earned = lifetime_admin_earned + admin_amt, updated_at = now() WHERE id = 1;
  END IF;

  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury SET platform_pool = platform_pool + pool_amt,
      lifetime_platform_earned = lifetime_platform_earned + pool_amt, updated_at = now() WHERE id = 1;
  END IF;

  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury SET platform_pool = platform_pool + store_extra,
      lifetime_platform_earned = lifetime_platform_earned + store_extra, updated_at = now() WHERE id = 1;
  END IF;

  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();
  END IF;

  SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
  pool_take := LEAST(GREATEST(pool_balance, 0), driver_base_pay);
  admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

  IF pool_take > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
    UPDATE public.admin_treasury SET platform_pool = GREATEST(platform_pool - pool_take, 0),
      lifetime_driver_topup = lifetime_driver_topup + pool_take, updated_at = now() WHERE id = 1;
  END IF;
  IF admin_subsidy > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
    UPDATE public.admin_treasury SET admin_balance = admin_balance - admin_subsidy,
      updated_at = now() WHERE id = 1;
  END IF;

  INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
  VALUES (NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt);

  IF is_cash THEN
    cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
    driver_share_total := driver_base_pay + tip_amt;
    amount_owed := GREATEST(cash_collected - driver_share_total, 0);
    IF amount_owed > 0 THEN
      INSERT INTO public.driver_cash_debts (driver_id, order_id, cash_collected, driver_share, amount_owed, store_share, platform_share, admin_share)
      VALUES (NEW.driver_id, NEW.id, cash_collected, driver_share_total, amount_owed, store_keeps_amt, pool_amt + store_extra, admin_amt);
    END IF;
  END IF;

  UPDATE public.orders SET commission_settled_at = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

-- 6. Backfill distance_km from store coords
UPDATE public.orders o
SET distance_km = public.haversine_km(s.latitude, s.longitude, o.delivery_latitude, o.delivery_longitude)
FROM public.stores s
WHERE o.store_id = s.id
  AND (o.distance_km IS NULL OR o.distance_km = 0)
  AND s.latitude IS NOT NULL AND o.delivery_latitude IS NOT NULL;

-- 7. Backfill driver_payout where missing on undelivered orders
UPDATE public.orders
SET driver_payout = public.quote_driver_payout(store_id, distance_km)
WHERE (driver_payout IS NULL OR driver_payout = 0)
  AND status::text NOT IN ('delivered','cancelled','refunded');

-- 8. Admin basket adjustment (add or remove funds)
CREATE OR REPLACE FUNCTION public.admin_adjust_basket(p_amount numeric, p_note text)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_new numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'amount must be non-zero'; END IF;

  UPDATE public.admin_treasury
    SET platform_pool = GREATEST(platform_pool + p_amount, 0),
        updated_at = now()
    WHERE id = 1
    RETURNING platform_pool INTO v_new;

  INSERT INTO public.admin_treasury_ledger (amount, bag, type, description, created_by)
  VALUES (p_amount, 'platform',
          CASE WHEN p_amount > 0 THEN 'admin_topup' ELSE 'admin_withdraw' END,
          COALESCE(NULLIF(trim(p_note), ''), 'Admin manual basket adjustment'),
          auth.uid());

  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_basket(numeric, text) TO authenticated;
