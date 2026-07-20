-- Source: 20260524000724_7905fa4d-eebe-4495-b9ec-65bb4563500c.sql

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


-- Source: 20260525000922_01659ae4-cebd-45ef-826f-50e834877429.sql
CREATE OR REPLACE FUNCTION public.cleanup_stale_dispatch_artifacts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offers integer := 0;
  v_runs   integer := 0;
  v_events integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.pending_offers
       SET status = 'expired',
           responded_at = COALESCE(responded_at, now())
     WHERE status = 'pending'
       AND offered_at < now() - interval '10 minutes'
     RETURNING 1
  )
  SELECT count(*) INTO v_offers FROM expired;

  DELETE FROM public.pending_offers
   WHERE COALESCE(responded_at, offered_at, created_at) < now() - interval '10 minutes';

  WITH del AS (
    DELETE FROM public.dispatch_runs
     WHERE started_at < now() - interval '10 minutes'
     RETURNING 1
  )
  SELECT count(*) INTO v_runs FROM del;

  WITH del2 AS (
    DELETE FROM public.driver_offer_events
     WHERE created_at < now() - interval '1 day'
     RETURNING 1
  )
  SELECT count(*) INTO v_events FROM del2;

  RETURN jsonb_build_object(
    'expired_offers', v_offers,
    'pruned_runs',    v_runs,
    'pruned_events',  v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_dispatch_artifacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_dispatch_artifacts() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('prune-dispatch-runs-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-stale-dispatch-every-minute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-stale-dispatch-every-minute',
  '* * * * *',
  $$ SELECT public.cleanup_stale_dispatch_artifacts(); $$
);

-- Source: 20260526011931_8b3fa3dd-4b43-4220-be12-482c7eafebc4.sql
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
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

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

  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
    VALUES (NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt);
  END IF;

  IF is_cash THEN
    cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
    driver_share_total := driver_base_pay + tip_amt;
    amount_owed := GREATEST(cash_collected - driver_share_total, 0);
    IF amount_owed > 0 AND NEW.driver_id IS NOT NULL THEN
      INSERT INTO public.driver_cash_debts (driver_id, order_id, cash_collected, driver_share, amount_owed, store_share, platform_share, admin_share)
      VALUES (NEW.driver_id, NEW.id, cash_collected, driver_share_total, amount_owed, store_keeps_amt, pool_amt + store_extra, admin_amt);
    END IF;
  END IF;

  -- BEFORE UPDATE trigger: stamp directly on NEW instead of issuing a
  -- recursive UPDATE on the same row (which caused
  -- "tuple to be updated was already modified by an operation
  --  triggered by the current command").
  NEW.commission_settled_at := now();
  RETURN NEW;
END;
$function$;

-- Source: 20260528000811_383ad978-9fc9-459f-99ca-8c2c868448c3.sql

-- 1) place_order: block same-coords (pickup == delivery) orders
CREATE OR REPLACE FUNCTION public.place_order(p_store_id uuid, p_items jsonb, p_delivery_address text, p_delivery_latitude double precision, p_delivery_longitude double precision, p_payment_method text, p_tip_amount numeric, p_delivery_fee numeric, p_notes text, p_scheduled_for timestamp with time zone, p_distance_km numeric, p_promo_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_promo record;
  v_promo_id uuid := NULL;
  v_order_id uuid;
  v_item jsonb;
  v_menu record;
  v_qty int;
  v_total numeric;
  v_fee numeric := COALESCE(p_delivery_fee, 0);
  v_tip numeric := GREATEST(COALESCE(p_tip_amount, 0), 0);
  v_status order_status;
  v_store_lat double precision;
  v_store_lon double precision;
  v_dist_m numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'No items'; END IF;
  IF p_payment_method NOT IN ('cash','card') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;

  -- Same-address guard: reject when delivery coords are within ~30m of the store.
  SELECT latitude, longitude INTO v_store_lat, v_store_lon FROM public.stores WHERE id = p_store_id;
  IF v_store_lat IS NOT NULL AND v_store_lon IS NOT NULL
     AND p_delivery_latitude IS NOT NULL AND p_delivery_longitude IS NOT NULL THEN
    v_dist_m := 6371000 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_store_lat)) * cos(radians(p_delivery_latitude))
      * cos(radians(p_delivery_longitude) - radians(v_store_lon))
      + sin(radians(v_store_lat)) * sin(radians(p_delivery_latitude))
    )));
    IF v_dist_m < 30 THEN
      RAISE EXCEPTION 'Η διεύθυνση παράδοσης συμπίπτει με τη διεύθυνση του καταστήματος. Διάλεξε διαφορετική.';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price, mi.store_id, mi.is_available, mi.is_snoozed
      INTO v_menu FROM public.menu_items mi WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found'; END IF;
    IF v_menu.store_id <> p_store_id THEN RAISE EXCEPTION 'Menu item does not belong to store'; END IF;
    IF COALESCE(v_menu.is_available, true) = false OR COALESCE(v_menu.is_snoozed, false) = true THEN
      RAISE EXCEPTION 'Menu item unavailable: %', v_menu.name;
    END IF;
    v_subtotal := v_subtotal + (v_menu.price * v_qty);
  END LOOP;

  IF p_promo_code IS NOT NULL AND length(trim(p_promo_code)) > 0 THEN
    SELECT * INTO v_promo FROM public.promo_codes
      WHERE lower(code) = lower(trim(p_promo_code)) AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR current_uses < max_uses)
        AND (store_id IS NULL OR store_id = p_store_id)
        AND min_order_amount <= v_subtotal LIMIT 1;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      IF v_promo.discount_type = 'percentage' THEN
        v_discount := LEAST(v_subtotal, v_subtotal * (v_promo.discount_value / 100));
      ELSE
        v_discount := LEAST(v_subtotal, v_promo.discount_value);
      END IF;
    END IF;
  END IF;

  v_total := GREATEST(0, v_subtotal - v_discount);
  v_status := CASE WHEN p_payment_method = 'card' THEN 'pending'::order_status ELSE 'placed'::order_status END;

  INSERT INTO public.orders (
    customer_id, store_id, status, payment_method,
    total_amount, delivery_fee, tip_amount,
    delivery_address, delivery_latitude, delivery_longitude,
    distance_km, notes, scheduled_for
  ) VALUES (
    v_user, p_store_id, v_status, p_payment_method,
    v_total, v_fee, v_tip,
    p_delivery_address, p_delivery_latitude, p_delivery_longitude,
    p_distance_km, NULLIF(p_notes, ''), p_scheduled_for
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price INTO v_menu FROM public.menu_items mi WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    INSERT INTO public.order_items (order_id, menu_item_id, name, quantity, unit_price)
    VALUES (v_order_id, v_menu.id, v_menu.name, v_qty, v_menu.price);
  END LOOP;

  IF v_promo_id IS NOT NULL THEN
    UPDATE public.promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
  END IF;

  RETURN v_order_id;
END;
$function$;

-- 2) Mission Control RPCs (admin-only)

-- Force-complete an order (sets status to delivered; commission trigger handles rest)
CREATE OR REPLACE FUNCTION public.admin_force_complete_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.orders
     SET status = 'delivered'::order_status,
         delivered_at = COALESCE(delivered_at, now())
   WHERE id = p_order_id;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description)
  VALUES (auth.uid(), 'force_complete_order', 'order', p_order_id::text, 'Admin force-completed order');
END $$;
GRANT EXECUTE ON FUNCTION public.admin_force_complete_order(uuid) TO authenticated;

-- Credit/debit any wallet (driver or customer)
CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(p_kind text, p_user_id uuid, p_amount numeric, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'amount must be non-zero'; END IF;

  IF p_kind = 'driver' THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance)
    VALUES (p_user_id, GREATEST(0, p_amount))
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = GREATEST(0, public.driver_wallets.available_balance + p_amount),
          updated_at = now()
    RETURNING available_balance INTO v_new;
    INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (p_user_id, CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END, p_amount, 'completed', COALESCE(p_note,'Admin adjustment'));
  ELSIF p_kind = 'customer' THEN
    INSERT INTO public.customer_wallets (user_id, balance, lifetime_credit)
    VALUES (p_user_id, GREATEST(0, p_amount), GREATEST(0, p_amount))
    ON CONFLICT (user_id) DO UPDATE
      SET balance = GREATEST(0, public.customer_wallets.balance + p_amount),
          lifetime_credit = public.customer_wallets.lifetime_credit + GREATEST(0, p_amount),
          updated_at = now()
    RETURNING balance INTO v_new;
    INSERT INTO public.customer_wallet_ledger (user_id, type, amount, description)
    VALUES (p_user_id, CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END, p_amount, COALESCE(p_note,'Admin adjustment'));
  ELSE
    RAISE EXCEPTION 'invalid wallet kind: %', p_kind;
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), 'wallet_adjust', p_kind, p_user_id::text,
          format('%s %s €%s', CASE WHEN p_amount>=0 THEN 'credit' ELSE 'debit' END, p_kind, p_amount),
          jsonb_build_object('amount', p_amount, 'note', p_note));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_wallet_adjust(text, uuid, numeric, text) TO authenticated;

-- Toggle maintenance mode (kill switch)
CREATE OR REPLACE FUNCTION public.admin_toggle_maintenance(p_on boolean, p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.platform_settings
     SET maintenance_mode = p_on,
         maintenance_message = COALESCE(p_message, maintenance_message)
   WHERE id = 1;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description)
  VALUES (auth.uid(), CASE WHEN p_on THEN 'maintenance_on' ELSE 'maintenance_off' END, 'platform', '1', COALESCE(p_message, ''));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_toggle_maintenance(boolean, text) TO authenticated;

-- Purge stale rows (dispatch_runs, dispatch_offers, audit log, driver_offer_events)
CREATE OR REPLACE FUNCTION public.admin_purge_stale(p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_kind = 'dispatch_runs' THEN
    DELETE FROM public.dispatch_runs WHERE started_at < now() - interval '24 hours';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'offer_events' THEN
    DELETE FROM public.driver_offer_events WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'audit' THEN
    DELETE FROM public.admin_audit_log WHERE created_at < now() - interval '90 days';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unknown purge kind: %', p_kind;
  END IF;
  RETURN jsonb_build_object('purged', v_count, 'kind', p_kind);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_purge_stale(text) TO authenticated;

-- Force-cancel stuck pending orders older than threshold (minutes)
CREATE OR REPLACE FUNCTION public.admin_cancel_stuck_orders(p_minutes int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.orders
     SET status = 'cancelled'::order_status
   WHERE status IN ('pending','placed') AND created_at < now() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), 'cancel_stuck_orders', 'orders', 'bulk', format('Cancelled %s stuck orders', v_count), jsonb_build_object('minutes', p_minutes, 'count', v_count));
  RETURN jsonb_build_object('cancelled', v_count);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_cancel_stuck_orders(int) TO authenticated;


-- Source: 20260529044958_ca396514-5937-4e30-be1d-c038d18454eb.sql
ALTER TABLE public.driver_state ADD COLUMN IF NOT EXISTS last_cash_reset_at timestamptz;

CREATE OR REPLACE FUNCTION public.admin_reset_driver_cash(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reset driver cash';
  END IF;

  INSERT INTO public.driver_state (driver_id, shift_cash_balance, shift_started_at, last_cash_reset_at)
  VALUES (p_driver_id, 0, now(), now())
  ON CONFLICT (driver_id) DO UPDATE
    SET shift_cash_balance = 0,
        shift_started_at = now(),
        last_cash_reset_at = now(),
        updated_at = now();

  PERFORM public.log_admin_action(
    'reset_driver_cash',
    'driver',
    p_driver_id::text,
    'Μηδένισε ταμείο βάρδιας οδηγού',
    '{}'::jsonb
  );
END;
$$;

-- Source: 20260529050021_86f9ae20-df4d-4b66-8202-7118db1e0c89.sql
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  split jsonb;
  admin_amt numeric := 0;
  pool_amt numeric := 0;
  delivery_amt numeric := 0;
  tip_amt numeric := 0;
  store_extra numeric := 0;
  store_keeps_amt numeric := 0;
  pool_balance numeric := 0;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean := false;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  driver_base_pay numeric := 0;
  locked_payout numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
    admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

    IF pool_take > 0 THEN
      INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
      VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
      UPDATE public.admin_treasury
        SET platform_pool = GREATEST(platform_pool - pool_take, 0),
            lifetime_driver_topup = lifetime_driver_topup + pool_take,
            updated_at = now()
        WHERE id = 1;
    END IF;

    IF admin_subsidy > 0 THEN
      INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
      VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
      UPDATE public.admin_treasury
        SET admin_balance = admin_balance - admin_subsidy,
            updated_at = now()
        WHERE id = 1;
    END IF;

    IF driver_share_total > 0 THEN
      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );

      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, driver_share_total, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + driver_share_total,
            updated_at = now();

      INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
      SELECT NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Κέρδος παράδοσης', NEW.id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.wallet_transactions wt
        WHERE wt.order_id = NEW.id
          AND wt.driver_id = NEW.driver_id
          AND wt.type = 'earning_credit'
      );
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, 0);
      IF cash_collected <= 0 THEN
        cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
      END IF;

      IF cash_collected > 0 THEN
        INSERT INTO public.driver_cash_debts (
          driver_id, order_id, cash_collected,
          driver_share, amount_owed, store_share, platform_share, admin_share, settled
        )
        SELECT NEW.driver_id, NEW.id, cash_collected,
               driver_share_total, cash_collected, store_keeps_amt, pool_amt + store_extra, admin_amt, false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.driver_cash_debts d WHERE d.order_id = NEW.id AND d.driver_id = NEW.driver_id
        );
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := driver_base_pay;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_driver_shift_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  physical_cash numeric := 0;
BEGIN
  physical_cash := COALESCE(NEW.cash_collected, NEW.amount_owed, 0);
  IF physical_cash > 0 AND NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.driver_state (driver_id, shift_cash_balance, shift_started_at)
    VALUES (NEW.driver_id, physical_cash, COALESCE((SELECT shift_started_at FROM public.driver_state WHERE driver_id = NEW.driver_id), now()))
    ON CONFLICT (driver_id) DO UPDATE
      SET shift_cash_balance = public.driver_state.shift_cash_balance + physical_cash,
          shift_started_at = COALESCE(public.driver_state.shift_started_at, now()),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Source: 20260530002350_7a7dff84-2e36-490a-8b77-970f9e57ce0d.sql

-- 1) PUBLIC CODES per role
CREATE SEQUENCE IF NOT EXISTS public.seq_code_customer START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_driver START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_store START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_support START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_admin START 1;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_code text UNIQUE;

CREATE OR REPLACE FUNCTION public.assign_profile_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  seq text;
  n bigint;
BEGIN
  IF NEW.public_code IS NOT NULL THEN RETURN NEW; END IF;
  CASE NEW.role::text
    WHEN 'driver'   THEN prefix := 'DRV'; seq := 'seq_code_driver';
    WHEN 'store'    THEN prefix := 'STR'; seq := 'seq_code_store';
    WHEN 'support'  THEN prefix := 'SUP'; seq := 'seq_code_support';
    WHEN 'admin'    THEN prefix := 'ADM'; seq := 'seq_code_admin';
    ELSE                 prefix := 'CUS'; seq := 'seq_code_customer';
  END CASE;
  EXECUTE format('SELECT nextval(%L)', 'public.'||seq) INTO n;
  NEW.public_code := prefix || '-' || lpad(n::text, 5, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_profile_code_trigger ON public.profiles;
CREATE TRIGGER assign_profile_code_trigger
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.assign_profile_code();

-- Backfill existing profiles in stable order per role
DO $$
DECLARE r RECORD; prefix text; seq text; n bigint;
BEGIN
  FOR r IN SELECT id, role FROM public.profiles WHERE public_code IS NULL ORDER BY role, created_at, id LOOP
    CASE r.role::text
      WHEN 'driver'  THEN prefix := 'DRV'; seq := 'seq_code_driver';
      WHEN 'store'   THEN prefix := 'STR'; seq := 'seq_code_store';
      WHEN 'support' THEN prefix := 'SUP'; seq := 'seq_code_support';
      WHEN 'admin'   THEN prefix := 'ADM'; seq := 'seq_code_admin';
      ELSE                prefix := 'CUS'; seq := 'seq_code_customer';
    END CASE;
    EXECUTE format('SELECT nextval(%L)', 'public.'||seq) INTO n;
    UPDATE public.profiles SET public_code = prefix||'-'||lpad(n::text,5,'0') WHERE id = r.id;
  END LOOP;
END $$;

-- Also keep code stable if role changes later (do nothing — preserve original)

-- 2) MONEY BUFFER settings (reuse admin_treasury.platform_pool as the buffer)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS buffer_floor numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS buffer_auto_fill_pct numeric NOT NULL DEFAULT 10;

-- 3) Distribute buffer RPC: modes = equal | top | surge
CREATE OR REPLACE FUNCTION public.admin_distribute_buffer(
  p_amount numeric,
  p_mode text DEFAULT 'equal',     -- equal | top | surge
  p_top_n integer DEFAULT 10,
  p_zone_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor numeric;
  v_pool numeric;
  v_recipients uuid[];
  v_count integer;
  v_per numeric;
  v_dist_id uuid;
  v_drv uuid;
  v_zone_lat double precision;
  v_zone_lng double precision;
  v_zone_radius numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT buffer_floor INTO v_floor FROM platform_settings WHERE id=1;
  SELECT platform_pool INTO v_pool FROM admin_treasury WHERE id=1 FOR UPDATE;
  IF v_pool - p_amount < COALESCE(v_floor,0) THEN
    RAISE EXCEPTION 'distribution would breach buffer floor (pool=%, floor=%)', v_pool, v_floor;
  END IF;

  -- Pick recipients
  IF p_mode = 'top' THEN
    SELECT array_agg(driver_id) INTO v_recipients FROM (
      SELECT driver_id, sum(COALESCE(total,base_pay+COALESCE(tip,0)+COALESCE(bonus,0))) s
      FROM earnings WHERE created_at > now() - interval '7 days'
      GROUP BY driver_id ORDER BY s DESC LIMIT GREATEST(p_top_n,1)
    ) t;
  ELSIF p_mode = 'surge' THEN
    IF p_zone_id IS NULL THEN RAISE EXCEPTION 'zone_id required for surge mode'; END IF;
    SELECT latitude, longitude, radius_km INTO v_zone_lat, v_zone_lng, v_zone_radius
      FROM demand_zones WHERE id = p_zone_id;
    SELECT array_agg(DISTINCT dl.driver_id) INTO v_recipients
    FROM driver_locations dl
    JOIN driver_state ds ON ds.driver_id = dl.driver_id
    WHERE dl.updated_at > now() - interval '20 minutes'
      AND (6371 * acos(
        cos(radians(v_zone_lat)) * cos(radians(dl.latitude)) *
        cos(radians(dl.longitude) - radians(v_zone_lng)) +
        sin(radians(v_zone_lat)) * sin(radians(dl.latitude))
      )) <= COALESCE(v_zone_radius,1);
  ELSE
    -- equal: all drivers with shift active in last 24h or with earnings in last 7d
    SELECT array_agg(DISTINCT driver_id) INTO v_recipients FROM (
      SELECT driver_id FROM earnings WHERE created_at > now() - interval '7 days'
      UNION
      SELECT driver_id FROM driver_state WHERE shift_started_at IS NOT NULL AND shift_started_at > now() - interval '24 hours'
    ) t;
  END IF;

  v_count := COALESCE(array_length(v_recipients,1),0);
  IF v_count = 0 THEN RAISE EXCEPTION 'no eligible drivers'; END IF;
  v_per := round((p_amount / v_count)::numeric, 2);

  INSERT INTO basket_distributions(triggered_by, created_by, total_amount, recipient_count, basket_balance_before, basket_balance_after, notes, snapshot)
  VALUES ('manual', auth.uid(), v_per * v_count, v_count, v_pool, v_pool - (v_per*v_count), p_note,
          jsonb_build_object('mode',p_mode,'top_n',p_top_n,'zone_id',p_zone_id,'recipients',v_recipients))
  RETURNING id INTO v_dist_id;

  FOREACH v_drv IN ARRAY v_recipients LOOP
    INSERT INTO driver_wallets(driver_id, available_balance)
    VALUES (v_drv, v_per)
    ON CONFLICT (driver_id) DO UPDATE SET available_balance = driver_wallets.available_balance + v_per, updated_at = now();

    INSERT INTO wallet_transactions(driver_id, type, amount, status, description)
    VALUES (v_drv, 'bonus', v_per, 'completed', 'Buffer distribution ('||p_mode||')');

    INSERT INTO basket_distribution_payouts(distribution_id, driver_id, amount, reason)
    VALUES (v_dist_id, v_drv, v_per, p_mode);
  END LOOP;

  UPDATE admin_treasury SET platform_pool = platform_pool - (v_per * v_count), updated_at = now() WHERE id = 1;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
  VALUES ('buffer_distribute', 'platform_pool', -(v_per*v_count),
          'Distribute '||p_mode||' to '||v_count||' drivers ('||COALESCE(p_note,'')||')', auth.uid());

  INSERT INTO admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(),'distribute_buffer','distribution',v_dist_id::text,
          'Distributed €'||(v_per*v_count)||' to '||v_count||' drivers',
          jsonb_build_object('mode',p_mode,'per_driver',v_per,'recipients',v_count));

  RETURN jsonb_build_object('distribution_id',v_dist_id,'per_driver',v_per,'recipients',v_count,'total',v_per*v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_distribute_buffer(numeric,text,integer,uuid,text) TO authenticated;


-- Source: 20260601032305_b8c9f536-23b5-4809-b61c-8ccc7760db14.sql

-- ============ BUFFER PROGRAMS: Quests, Guarantees, Streaks, Budgets ============

-- 1) Driver Quests (challenges)
CREATE TABLE public.driver_quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  target_type text NOT NULL DEFAULT 'deliveries', -- 'deliveries' | 'earnings' | 'acceptance_streak'
  target_value numeric NOT NULL DEFAULT 10,
  reward_amount numeric NOT NULL DEFAULT 20,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  -- Eligibility
  min_rating numeric DEFAULT NULL,
  min_tenure_days integer DEFAULT NULL,
  vehicle_types text[] DEFAULT NULL,
  zone_id uuid DEFAULT NULL,
  -- Budget
  budget_cap numeric DEFAULT NULL,
  budget_spent numeric NOT NULL DEFAULT 0,
  -- Meta
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_quests TO authenticated;
GRANT ALL ON public.driver_quests TO service_role;
ALTER TABLE public.driver_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage quests" ON public.driver_quests FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view active quests" ON public.driver_quests FOR SELECT
  USING (is_active = true AND has_role(auth.uid(),'driver'));

-- 2) Per-driver progress
CREATE TABLE public.driver_quest_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id uuid NOT NULL REFERENCES public.driver_quests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  current_value numeric NOT NULL DEFAULT 0,
  claimed boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quest_id, driver_id)
);
GRANT SELECT, INSERT, UPDATE ON public.driver_quest_progress TO authenticated;
GRANT ALL ON public.driver_quest_progress TO service_role;
ALTER TABLE public.driver_quest_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage progress" ON public.driver_quest_progress FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view own progress" ON public.driver_quest_progress FOR SELECT
  USING (auth.uid() = driver_id);

-- 3) Guaranteed earnings windows
CREATE TABLE public.driver_guarantees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  min_per_hour numeric NOT NULL DEFAULT 8,
  day_of_week smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,0}'::smallint[], -- 0=Sun
  start_time time NOT NULL DEFAULT '19:00',
  end_time time NOT NULL DEFAULT '23:00',
  zone_id uuid,
  min_acceptance_pct numeric DEFAULT 80,
  is_active boolean NOT NULL DEFAULT true,
  budget_cap numeric,
  budget_spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_guarantees TO authenticated;
GRANT ALL ON public.driver_guarantees TO service_role;
ALTER TABLE public.driver_guarantees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage guarantees" ON public.driver_guarantees FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view active guarantees" ON public.driver_guarantees FOR SELECT
  USING (is_active = true AND has_role(auth.uid(),'driver'));

-- 4) Surge multipliers (extend demand_zones)
ALTER TABLE public.demand_zones
  ADD COLUMN IF NOT EXISTS multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS surge_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS surge_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_surge boolean NOT NULL DEFAULT false;

-- 5) Streak bonuses
CREATE TABLE public.streak_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  consecutive_accepts integer NOT NULL DEFAULT 5,
  reward_amount numeric NOT NULL DEFAULT 5,
  window_hours integer NOT NULL DEFAULT 4,
  is_active boolean NOT NULL DEFAULT true,
  budget_cap numeric,
  budget_spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streak_bonuses TO authenticated;
GRANT ALL ON public.streak_bonuses TO service_role;
ALTER TABLE public.streak_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage streaks" ON public.streak_bonuses FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view active streaks" ON public.streak_bonuses FOR SELECT
  USING (is_active = true AND has_role(auth.uid(),'driver'));

-- 6) Admin manual buffer adjust (top up / drain / empty)
CREATE OR REPLACE FUNCTION public.admin_adjust_buffer(
  p_amount numeric,
  p_action text, -- 'add' | 'remove' | 'set'
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_delta numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT platform_pool INTO v_before FROM admin_treasury WHERE id = 1 FOR UPDATE;

  IF p_action = 'add' THEN
    v_after := v_before + p_amount;
  ELSIF p_action = 'remove' THEN
    v_after := GREATEST(0, v_before - p_amount);
  ELSIF p_action = 'set' THEN
    v_after := GREATEST(0, p_amount);
  ELSE
    RAISE EXCEPTION 'invalid action';
  END IF;

  v_delta := v_after - v_before;

  UPDATE admin_treasury SET platform_pool = v_after, updated_at = now() WHERE id = 1;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
  VALUES ('manual_adjust', 'platform_pool', v_delta, COALESCE(p_reason, p_action), auth.uid());

  RETURN jsonb_build_object('before', v_before, 'after', v_after, 'delta', v_delta);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_buffer(numeric, text, text) TO authenticated;

-- 7) Claim quest reward (driver-initiated, server-validated)
CREATE OR REPLACE FUNCTION public.claim_quest_reward(p_quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver uuid := auth.uid();
  v_quest driver_quests%ROWTYPE;
  v_progress driver_quest_progress%ROWTYPE;
  v_pool numeric;
BEGIN
  IF v_driver IS NULL OR NOT has_role(v_driver,'driver') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_quest FROM driver_quests WHERE id = p_quest_id FOR UPDATE;
  IF NOT FOUND OR NOT v_quest.is_active THEN
    RAISE EXCEPTION 'quest not available';
  END IF;
  IF v_quest.ends_at IS NOT NULL AND v_quest.ends_at < now() THEN
    RAISE EXCEPTION 'quest ended';
  END IF;
  IF v_quest.budget_cap IS NOT NULL AND v_quest.budget_spent + v_quest.reward_amount > v_quest.budget_cap THEN
    RAISE EXCEPTION 'quest budget exhausted';
  END IF;

  SELECT * INTO v_progress FROM driver_quest_progress
    WHERE quest_id = p_quest_id AND driver_id = v_driver FOR UPDATE;
  IF NOT FOUND OR v_progress.current_value < v_quest.target_value THEN
    RAISE EXCEPTION 'goal not reached';
  END IF;
  IF v_progress.claimed THEN
    RAISE EXCEPTION 'already claimed';
  END IF;

  SELECT platform_pool INTO v_pool FROM admin_treasury WHERE id = 1 FOR UPDATE;
  IF v_pool < v_quest.reward_amount THEN
    RAISE EXCEPTION 'buffer depleted';
  END IF;

  -- Debit pool, credit driver wallet
  UPDATE admin_treasury SET platform_pool = platform_pool - v_quest.reward_amount, updated_at = now() WHERE id = 1;
  UPDATE driver_wallets SET available_balance = available_balance + v_quest.reward_amount, updated_at = now()
    WHERE driver_id = v_driver;

  UPDATE driver_quest_progress SET claimed = true, claimed_at = now(), updated_at = now()
    WHERE id = v_progress.id;
  UPDATE driver_quests SET budget_spent = budget_spent + v_quest.reward_amount, updated_at = now()
    WHERE id = p_quest_id;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
    VALUES ('quest_payout', 'platform_pool', -v_quest.reward_amount,
            'Quest: ' || v_quest.title, v_driver);

  RETURN jsonb_build_object('reward', v_quest.reward_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_quest_reward(uuid) TO authenticated;

-- 8) Auto-increment quest progress on delivered orders
CREATE OR REPLACE FUNCTION public.bump_quest_progress() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  q RECORD;
  v_inc numeric;
BEGIN
  IF NEW.status::text != 'delivered' OR OLD.status::text = 'delivered' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR q IN
    SELECT * FROM driver_quests
    WHERE is_active = true
      AND starts_at <= now()
      AND (ends_at IS NULL OR ends_at > now())
  LOOP
    v_inc := CASE q.target_type
      WHEN 'deliveries' THEN 1
      WHEN 'earnings' THEN COALESCE(NEW.total_amount, 0)
      ELSE 0
    END;
    IF v_inc <= 0 THEN CONTINUE; END IF;

    INSERT INTO driver_quest_progress(quest_id, driver_id, current_value)
    VALUES (q.id, NEW.driver_id, v_inc)
    ON CONFLICT (quest_id, driver_id)
    DO UPDATE SET current_value = driver_quest_progress.current_value + v_inc, updated_at = now()
    WHERE NOT driver_quest_progress.claimed;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_quest_progress ON public.orders;
CREATE TRIGGER trg_bump_quest_progress
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.bump_quest_progress();


-- Source: 20260602033938_c756b572-3a85-4980-9373-ac52db68bcbf.sql
CREATE OR REPLACE FUNCTION public.admin_adjust_buffer(
  p_amount numeric,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_delta numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT platform_pool INTO v_before FROM admin_treasury WHERE id = 1 FOR UPDATE;

  IF p_action = 'add' THEN
    v_after := v_before + p_amount;
  ELSIF p_action = 'remove' THEN
    v_after := GREATEST(0, v_before - p_amount);
  ELSIF p_action = 'set' THEN
    v_after := GREATEST(0, p_amount);
  ELSE
    RAISE EXCEPTION 'invalid action';
  END IF;

  v_delta := v_after - v_before;

  -- Write audited ledger entry FIRST so the basket guard trigger sees it
  -- (guard looks for bag='platform' with amount<0 in the last 5 seconds).
  IF v_delta <> 0 THEN
    INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
    VALUES ('manual_adjust', 'platform', v_delta, COALESCE(p_reason, p_action), auth.uid());
  END IF;

  UPDATE admin_treasury SET platform_pool = v_after, updated_at = now() WHERE id = 1;

  RETURN jsonb_build_object('before', v_before, 'after', v_after, 'delta', v_delta);
END;
$$;

-- Source: 20260604035721_f7aaea07-adcb-4d9f-963c-deb648f3c11a.sql
CREATE OR REPLACE FUNCTION public.admin_adjust_admin_buffer(
  p_amount numeric,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_delta numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT admin_balance INTO v_before FROM admin_treasury WHERE id = 1 FOR UPDATE;

  IF p_action = 'add' THEN
    v_after := v_before + p_amount;
  ELSIF p_action = 'remove' THEN
    v_after := GREATEST(0, v_before - p_amount);
  ELSIF p_action = 'set' THEN
    v_after := GREATEST(0, p_amount);
  ELSE
    RAISE EXCEPTION 'invalid action';
  END IF;

  v_delta := v_after - v_before;

  UPDATE admin_treasury SET admin_balance = v_after, updated_at = now() WHERE id = 1;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
  VALUES ('manual_adjust', 'admin', v_delta, COALESCE(p_reason, p_action), auth.uid());

  RETURN jsonb_build_object('before', v_before, 'after', v_after, 'delta', v_delta);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_admin_buffer(numeric, text, text) TO authenticated;

-- Source: 20260605035139_4c52597f-1174-451d-88b1-2115d3667b34.sql

CREATE OR REPLACE FUNCTION public.admin_reset_store_lifetime(p_store_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store lifetime';
  END IF;
  SELECT lifetime_earnings INTO v_before FROM store_wallets WHERE store_id = p_store_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Store wallet not found'; END IF;
  UPDATE store_wallets SET lifetime_earnings = 0, updated_at = now() WHERE store_id = p_store_id;
  PERFORM log_admin_action('reset_store_lifetime', 'store', p_store_id::text,
    'Lifetime earnings reset from ' || v_before || '€ to 0', '{}'::jsonb);
  RETURN v_before;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_store_lifetime()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store lifetime';
  END IF;
  UPDATE store_wallets SET lifetime_earnings = 0, updated_at = now() WHERE lifetime_earnings <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM log_admin_action('reset_all_store_lifetime', 'store', NULL,
    'Bulk reset lifetime for ' || v_count || ' stores', '{}'::jsonb);
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_driver_lifetime(p_driver_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset driver lifetime';
  END IF;
  SELECT COALESCE(total_withdrawn, 0) INTO v_before FROM driver_wallets WHERE driver_id = p_driver_id;
  UPDATE driver_wallets SET total_withdrawn = 0, updated_at = now() WHERE driver_id = p_driver_id;
  PERFORM log_admin_action('reset_driver_lifetime', 'driver', p_driver_id::text,
    'Lifetime totals reset (was withdrawn=' || v_before || '€)', '{}'::jsonb);
  RETURN v_before;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_driver_lifetime()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset driver lifetime';
  END IF;
  UPDATE driver_wallets SET total_withdrawn = 0, updated_at = now() WHERE total_withdrawn <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM log_admin_action('reset_all_driver_lifetime', 'driver', NULL,
    'Bulk reset lifetime for ' || v_count || ' drivers', '{}'::jsonb);
  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_reset_store_lifetime(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_store_lifetime() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_driver_lifetime(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_driver_lifetime() TO authenticated;


-- Source: 20260607050050_b6dcc21e-35e7-4298-b0ec-409c81f2d934.sql

-- 1) Add settings flag to allow pickup before ready
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS allow_pickup_before_ready boolean NOT NULL DEFAULT false;

-- 2) Create pending driver payouts table for when buffer is too low
CREATE TABLE IF NOT EXISTS public.pending_driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount numeric NOT NULL,
  reason text NOT NULL DEFAULT 'pool_insufficient',
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, driver_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_driver_payouts TO authenticated;
GRANT ALL ON public.pending_driver_payouts TO service_role;

ALTER TABLE public.pending_driver_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pending payouts" ON public.pending_driver_payouts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Drivers see their pending payouts" ON public.pending_driver_payouts
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- 3) Update settle_order_commission to honor pause_bonus_when_critical / subsidize_min_pay
CREATE OR REPLACE FUNCTION public.settle_order_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric := 0;
  pool_amt numeric := 0;
  delivery_amt numeric := 0;
  tip_amt numeric := 0;
  store_extra numeric := 0;
  store_keeps_amt numeric := 0;
  pool_balance numeric := 0;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean := false;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  driver_base_pay numeric := 0;
  locked_payout numeric := 0;
  s_pause boolean := false;
  s_subsidize boolean := false;
  s_low numeric := 0;
  s_alert boolean := true;
  pay_paused boolean := false;
  shortfall numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

  SELECT pause_bonus_when_critical, subsidize_min_pay, low_pool_threshold, pool_alert_enabled
    INTO s_pause, s_subsidize, s_low, s_alert
    FROM public.platform_settings WHERE id = 1;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    shortfall := GREATEST(driver_base_pay - pool_balance, 0);

    -- NEW LOGIC: pause payout when pool is low AND admin opted into pause + no subsidy
    pay_paused := (COALESCE(s_pause, false)
                   AND NOT COALESCE(s_subsidize, false)
                   AND shortfall > 0
                   AND pool_balance < COALESCE(s_low, 0));

    IF pay_paused THEN
      -- queue the full pay as a pending payout; nothing leaves the buffer
      INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
      VALUES (NEW.driver_id, NEW.id, driver_base_pay + tip_amt, 'pool_insufficient')
      ON CONFLICT (order_id, driver_id) DO NOTHING;

      IF COALESCE(s_alert, true) THEN
        INSERT INTO public.announcements (title, message, target_audience, expires_at)
        VALUES (
          'Driver Buffer χαμηλό',
          'Παραγγελία ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' δεν πληρώθηκε σε driver (απαιτείται €' || ROUND(driver_base_pay,2)
            || ', διαθέσιμο €' || ROUND(pool_balance,2) || '). Top-up το Driver Buffer.',
          'admin',
          now() + interval '24 hours'
        );
      END IF;

      driver_share_total := 0;
      pool_take := 0;
      admin_subsidy := 0;
    ELSE
      pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
      admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

      -- Only subsidize from admin if admin opted in; otherwise pay only what pool has
      IF admin_subsidy > 0 AND NOT COALESCE(s_subsidize, false) THEN
        -- pay only what's in the pool, queue the rest
        IF admin_subsidy > 0 THEN
          INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
          VALUES (NEW.driver_id, NEW.id, admin_subsidy, 'pool_insufficient')
          ON CONFLICT (order_id, driver_id) DO NOTHING;

          IF COALESCE(s_alert, true) THEN
            INSERT INTO public.announcements (title, message, target_audience, expires_at)
            VALUES (
              'Driver Buffer χαμηλό',
              'Λείπουν €' || ROUND(admin_subsidy,2) || ' από driver payout (order '
                || COALESCE(NEW.external_ref, NEW.id::text) || '). Top-up το Driver Buffer.',
              'admin',
              now() + interval '24 hours'
            );
          END IF;
        END IF;
        admin_subsidy := 0;
        driver_base_pay := pool_take;
      END IF;

      driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

      IF pool_take > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
        UPDATE public.admin_treasury
          SET platform_pool = GREATEST(platform_pool - pool_take, 0),
              lifetime_driver_topup = lifetime_driver_topup + pool_take,
              updated_at = now()
          WHERE id = 1;
      END IF;

      IF admin_subsidy > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - admin_subsidy,
              updated_at = now()
          WHERE id = 1;
      END IF;

      IF driver_share_total > 0 THEN
        INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
        SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
        WHERE NOT EXISTS (
          SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
        );

        INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
        VALUES (NEW.driver_id, driver_share_total, 0, 0)
        ON CONFLICT (driver_id) DO UPDATE
          SET available_balance = public.driver_wallets.available_balance + driver_share_total,
              updated_at = now();

        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        SELECT NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Κέρδος παράδοσης', NEW.id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.wallet_transactions wt
          WHERE wt.order_id = NEW.id
            AND wt.driver_id = NEW.driver_id
            AND wt.type = 'earning_credit'
        );
      END IF;
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, 0);
      IF cash_collected <= 0 THEN
        cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
      END IF;

      IF cash_collected > 0 THEN
        INSERT INTO public.driver_cash_debts (
          driver_id, order_id, cash_collected,
          driver_share, amount_owed, store_share, platform_share, admin_share, settled
        )
        SELECT NEW.driver_id, NEW.id, cash_collected,
               driver_share_total, cash_collected, store_keeps_amt, pool_amt + store_extra, admin_amt, false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.driver_cash_debts d WHERE d.order_id = NEW.id AND d.driver_id = NEW.driver_id
        );
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := driver_base_pay;
  RETURN NEW;
END;
$function$;

-- 4) Update guard_picked_up_requires_ready to honor allow_pickup_before_ready setting
CREATE OR REPLACE FUNCTION public.guard_picked_up_requires_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allow boolean := false;
BEGIN
  IF NEW.status::text = 'picked_up'
     AND OLD.status::text NOT IN ('ready', 'arrived', 'picked_up') THEN
    SELECT COALESCE(allow_pickup_before_ready, false)
      INTO v_allow FROM public.platform_settings WHERE id = 1;
    IF NOT v_allow THEN
      RAISE EXCEPTION 'Order must be marked ready by the store before pickup'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5) RPC: admin resolves a pending payout (credits driver wallet + drains buffer or admin bag)
CREATE OR REPLACE FUNCTION public.admin_release_pending_payout(p_pending_id uuid, p_source text DEFAULT 'pool')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_pool numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can release pending payouts';
  END IF;

  SELECT * INTO p FROM public.pending_driver_payouts WHERE id = p_pending_id FOR UPDATE;
  IF NOT FOUND OR p.resolved THEN
    RAISE EXCEPTION 'Pending payout not found or already resolved';
  END IF;

  IF p_source = 'pool' THEN
    SELECT COALESCE(platform_pool,0) INTO v_pool FROM public.admin_treasury WHERE id=1;
    IF v_pool < p.amount THEN
      RAISE EXCEPTION 'Driver Buffer ανεπαρκές (διαθέσιμο €%, χρειάζεται €%)', v_pool, p.amount;
    END IF;
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool - p.amount,
          lifetime_driver_topup = lifetime_driver_topup + p.amount,
          updated_at = now()
      WHERE id = 1;
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (-p.amount, 'platform', 'driver_payout', p.order_id, 'Pending payout released from pool');
  ELSE
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance - p.amount,
          updated_at = now()
      WHERE id = 1;
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (-p.amount, 'admin', 'driver_subsidy', p.order_id, 'Pending payout released from admin');
  END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance)
  VALUES (p.driver_id, p.amount)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = public.driver_wallets.available_balance + p.amount,
        updated_at = now();

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
  VALUES (p.driver_id, 'earning_credit', p.amount, 'completed', 'Pending payout released', p.order_id);

  UPDATE public.pending_driver_payouts
    SET resolved = true, resolved_at = now(), resolved_by = auth.uid()
    WHERE id = p.id;

  RETURN jsonb_build_object('ok', true, 'amount', p.amount);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_release_pending_payout(uuid, text) TO authenticated;


-- Source: 20260608065646_23863485-b819-4a52-8706-79836b799ef6.sql

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS accept_offer_requires_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_arrive_before_pickup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_deliver_before_arrive boolean NOT NULL DEFAULT false;


-- Source: 20260608070440_6b6987a9-715f-4ea3-b36f-006a720e6e8e.sql
ALTER TABLE public.announcements ALTER COLUMN created_by DROP NOT NULL;

-- Source: 20260608070521_ecc39310-dcc2-40c4-be71-b3da38249bd6.sql

CREATE OR REPLACE FUNCTION public.admin_force_end_driver_shift(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  UPDATE public.driver_states
     SET shift_started_at = NULL,
         on_break = false,
         break_started_at = NULL
   WHERE driver_id = p_driver_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_driver_bonus(
  p_driver_id uuid,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, lifetime_earned)
  VALUES (p_driver_id, p_amount, 0, p_amount)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = public.driver_wallets.available_balance + EXCLUDED.available_balance,
        lifetime_earned   = public.driver_wallets.lifetime_earned   + EXCLUDED.lifetime_earned,
        updated_at = now();

  INSERT INTO public.driver_wallet_transactions (driver_id, amount, kind, note, created_by)
  VALUES (p_driver_id, p_amount, 'admin_bonus', COALESCE(p_note, 'Admin bonus'), auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_end_driver_shift(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_driver_bonus(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_end_driver_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_driver_bonus(uuid, numeric, text) TO authenticated;


-- Source: 20260608070648_359f8d67-a8fe-4b4e-a9c8-2ba0d100f2b0.sql

CREATE OR REPLACE FUNCTION public.admin_grant_driver_bonus(
  p_driver_id uuid,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, lifetime_earned)
  VALUES (p_driver_id, p_amount, 0, p_amount)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = public.driver_wallets.available_balance + EXCLUDED.available_balance,
        lifetime_earned   = public.driver_wallets.lifetime_earned   + EXCLUDED.lifetime_earned,
        updated_at = now();
END;
$$;


-- Source: 20260609050459_c41f10dc-5742-41d4-97ce-57d837d74541.sql
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_target_audience_check;
ALTER TABLE public.announcements ADD CONSTRAINT announcements_target_audience_check
  CHECK (target_audience = ANY (ARRAY['drivers','store_owners','support','admin','all']));

-- Source: 20260609050941_858fe248-af23-45cf-8a4e-427622de8aee.sql
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric := 0;
  pool_amt numeric := 0;
  delivery_amt numeric := 0;
  tip_amt numeric := 0;
  store_extra numeric := 0;
  store_keeps_amt numeric := 0;
  pool_balance numeric := 0;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean := false;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  driver_base_pay numeric := 0;
  locked_payout numeric := 0;
  s_pause boolean := false;
  s_subsidize boolean := false;
  s_low numeric := 0;
  s_alert boolean := true;
  pay_paused boolean := false;
  shortfall numeric := 0;
  queued_amount numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

  SELECT pause_bonus_when_critical, subsidize_min_pay, low_pool_threshold, pool_alert_enabled
    INTO s_pause, s_subsidize, s_low, s_alert
    FROM public.platform_settings WHERE id = 1;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    shortfall := GREATEST(driver_base_pay - pool_balance, 0);

    pay_paused := (COALESCE(s_pause, false)
                   AND NOT COALESCE(s_subsidize, false)
                   AND shortfall > 0
                   AND pool_balance < COALESCE(s_low, 0));

    IF pay_paused THEN
      INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
      VALUES (NEW.driver_id, NEW.id, driver_base_pay + tip_amt, 'pool_insufficient')
      ON CONFLICT (order_id, driver_id) DO NOTHING;

      IF COALESCE(s_alert, true) THEN
        INSERT INTO public.announcements (title, message, target_audience, expires_at)
        VALUES (
          'Driver Buffer χαμηλό',
          'Παραγγελία ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' δεν πληρώθηκε σε driver (απαιτείται €' || ROUND(driver_base_pay,2)
            || ', διαθέσιμο €' || ROUND(pool_balance,2) || '). Top-up το Driver Buffer.',
          'admin',
          now() + interval '24 hours'
        );
      END IF;

      pool_take := 0;
      admin_subsidy := 0;
      driver_share_total := 0;

      -- Still record the trip in earnings so it counts in stats/history.
      -- Wallet credit will happen when admin releases the pending payout.
      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );
    ELSE
      pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
      admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

      IF admin_subsidy > 0 AND NOT COALESCE(s_subsidize, false) THEN
        queued_amount := admin_subsidy;
        INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
        VALUES (NEW.driver_id, NEW.id, queued_amount, 'pool_insufficient')
        ON CONFLICT (order_id, driver_id) DO NOTHING;

        IF COALESCE(s_alert, true) THEN
          INSERT INTO public.announcements (title, message, target_audience, expires_at)
          VALUES (
            'Driver Buffer χαμηλό',
            'Λείπουν €' || ROUND(queued_amount,2) || ' από driver payout (order '
              || COALESCE(NEW.external_ref, NEW.id::text) || '). Top-up το Driver Buffer.',
            'admin',
            now() + interval '24 hours'
          );
        END IF;
        admin_subsidy := 0;
        driver_base_pay := pool_take;
      END IF;

      driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

      IF pool_take > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
        UPDATE public.admin_treasury
          SET platform_pool = GREATEST(platform_pool - pool_take, 0),
              lifetime_driver_topup = lifetime_driver_topup + pool_take,
              updated_at = now()
          WHERE id = 1;
      END IF;

      IF admin_subsidy > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - admin_subsidy,
              updated_at = now()
          WHERE id = 1;
      END IF;

      -- Always record trip in earnings (driver_base_pay reflects what they actually got from buffer/admin now)
      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );

      IF driver_share_total > 0 THEN
        INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
        VALUES (NEW.driver_id, driver_share_total, 0, 0)
        ON CONFLICT (driver_id) DO UPDATE
          SET available_balance = public.driver_wallets.available_balance + driver_share_total,
              updated_at = now();

        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        SELECT NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Κέρδος παράδοσης', NEW.id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.wallet_transactions wt
          WHERE wt.order_id = NEW.id
            AND wt.driver_id = NEW.driver_id
            AND wt.type = 'earning_credit'
        );
      END IF;
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, 0);
      IF cash_collected <= 0 THEN
        cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
      END IF;

      IF cash_collected > 0 THEN
        INSERT INTO public.driver_cash_debts (
          driver_id, order_id, cash_collected,
          driver_share, amount_owed, store_share, platform_share, admin_share, settled
        )
        SELECT NEW.driver_id, NEW.id, cash_collected,
               driver_share_total, cash_collected, store_keeps_amt, pool_amt + store_extra, admin_amt, false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.driver_cash_debts d WHERE d.order_id = NEW.id AND d.driver_id = NEW.driver_id
        );
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := driver_base_pay;
  RETURN NEW;
END;
$function$;

-- Backfill the recent delivered order whose earnings row was skipped
INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
SELECT o.driver_id, o.id,
       COALESCE(p.amount, 0) - COALESCE(o.tip_amount, 0),
       0,
       COALESCE(o.tip_amount, 0)
FROM public.orders o
JOIN public.pending_driver_payouts p ON p.order_id = o.id AND p.driver_id = o.driver_id AND p.resolved = false
WHERE o.status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM public.earnings e WHERE e.order_id = o.id AND e.driver_id = o.driver_id
  );

