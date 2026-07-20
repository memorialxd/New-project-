-- Source: 20260514033820_5cb07279-1c09-4268-9d39-c97710e0f12d.sql
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  tip_amt numeric;
  store_extra numeric;
  store_keeps_amt numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  pool_take numeric;
  is_cash boolean;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  amount_owed numeric := 0;
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

  -- ADMIN bag
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- PLATFORM POOL (driver pool top-up)
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Extra store commission (>15%) → platform pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- STORE WALLET — credit the store's share for every delivered order
  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();

    INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', store_keeps_amt,
            CASE WHEN is_cash THEN 'Μερίδιο καταστήματος (μετρητά)'
                 ELSE 'Μερίδιο καταστήματος (κάρτα)' END);
  END IF;

  -- DRIVER share
  IF NEW.driver_id IS NOT NULL THEN
    bonus_info := public.compute_driver_pool_bonus(NEW.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    subsidy_amt := COALESCE((bonus_info->>'admin_subsidy')::numeric, 0);

    IF bonus_amt > 0 THEN
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_take := LEAST(pool_balance, GREATEST(bonus_amt - subsidy_amt, 0));
      IF pool_take > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_bonus', NEW.id, 'Pool bonus paid to driver');
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_take, updated_at = now()
          WHERE id = 1;
      END IF;

      IF subsidy_amt > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-subsidy_amt, 'admin', 'pool_subsidy', NEW.id, 'Admin subsidy to honor min driver pay');
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - subsidy_amt, updated_at = now()
          WHERE id = 1;
      END IF;
    END IF;

    driver_share_total := COALESCE(bonus_amt, 0)
                        + COALESCE(delivery_amt, 0)
                        + COALESCE(tip_amt, 0);

    -- Always credit driver wallet with their earnings (cash or card)
    IF driver_share_total > 0 THEN
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, driver_share_total, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + driver_share_total,
            updated_at = now();

      IF bonus_amt > 0 THEN
        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        VALUES (NEW.driver_id, 'earning_credit', bonus_amt, 'completed',
                'Πληρωμή παράδοσης (driver pool)', NEW.id);
      END IF;
      IF delivery_amt > 0 THEN
        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        VALUES (NEW.driver_id, 'earning_credit', delivery_amt, 'completed',
                'Delivery fee', NEW.id);
      END IF;
      IF tip_amt > 0 THEN
        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        VALUES (NEW.driver_id, 'earning_credit', tip_amt, 'completed',
                'Tip', NEW.id);
      END IF;
    END IF;

    -- Cash orders: driver owes the FULL cash collected to the platform
    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, NEW.total_amount, 0);
      amount_owed := cash_collected;

      INSERT INTO public.driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share,
        amount_owed, settled
      ) VALUES (
        NEW.driver_id, NEW.id, cash_collected,
        driver_share_total, store_keeps_amt, admin_amt,
        pool_amt + store_extra, amount_owed, false
      );
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := bonus_amt;

  RETURN NEW;
END;
$$;

-- Source: 20260514035147_a927a510-ceec-4504-a1d9-0144d991ccc7.sql
-- Fix storage policy that referenced the wrong column (store name instead of object path)
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;
DO $$ BEGIN
CREATE POLICY "Store owners view their order proofs"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'order-proofs'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND (storage.foldername(storage.objects.name))[1] = (o.id)::text
  )
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pin search_path on remaining trigger function
ALTER FUNCTION public.guard_picked_up_requires_ready() SET search_path = public;

-- Source: 20260515001021_4e1f8b59-fa6c-4e1a-9479-72b1f8897db8.sql
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_dispatch_enabled boolean NOT NULL DEFAULT true;

-- Source: 20260515001303_257aca34-1dbc-4492-94ef-02cc3cb0583a.sql
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

  v_tip := COALESCE(NEW.tip_amount, 0);

  -- Prefer the payout the driver actually accepted (driver_payout locked at order time).
  -- Fall back to formula only when payout wasn't set.
  IF COALESCE(NEW.driver_payout, 0) > 0 THEN
    v_total_base := NEW.driver_payout;
  ELSE
    SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
    SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = NEW.store_id;

    v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
    v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
    v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
    v_km     := COALESCE(NEW.distance_km, 0);

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
  END IF;

  INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus)
  VALUES (NEW.driver_id, NEW.id, v_total_base, v_tip, 0);

  RETURN NEW;
END;
$$;

-- Backfill: any existing earnings rows where base_pay differs from the locked driver_payout get realigned.
UPDATE public.earnings e
SET base_pay = o.driver_payout
FROM public.orders o
WHERE e.order_id = o.id
  AND COALESCE(o.driver_payout, 0) > 0
  AND e.base_pay <> o.driver_payout;

-- Source: 20260516001305_c7fc0648-6b47-460a-9f2a-bf6c1916c745.sql
-- Fix driver completion rewards: pay base + km + tip, and keep earnings records in sync.

-- The settlement trigger is the single wallet-credit path; this legacy trigger can double-credit wallets
-- when earnings rows are inserted for reporting.
DROP TRIGGER IF EXISTS credit_wallet_after_earning ON public.earnings;
DROP TRIGGER IF EXISTS trg_credit_wallet_on_earning ON public.earnings;

CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  tip_amt numeric;
  store_extra numeric;
  store_keeps_amt numeric;
  pays_delivery boolean;
  pool_balance numeric;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  amount_owed numeric := 0;
  v_settings public.platform_settings%ROWTYPE;
  v_override public.store_pricing_overrides%ROWTYPE;
  v_base numeric;
  v_per_km numeric;
  v_min numeric;
  v_max numeric;
  v_km numeric;
  driver_base_pay numeric := 0;
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

  -- Driver route pay is guaranteed: configured base + per-km, clamped by min/max, plus tip.
  SELECT * INTO v_settings FROM public.platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM public.store_pricing_overrides WHERE store_id = NEW.store_id;
  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_max    := COALESCE(v_override.max_pay,     v_settings.max_pay,     999999);
  v_km     := COALESCE(NEW.distance_km, 0);
  driver_base_pay := ROUND(LEAST(GREATEST(v_base + v_per_km * v_km, v_min), v_max)::numeric, 2);

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  -- ADMIN bag
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- PLATFORM POOL (driver pool top-up)
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Extra store commission (>15%) → platform pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- STORE WALLET — credit the store's share for every delivered order
  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();

    INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', store_keeps_amt,
            CASE WHEN is_cash THEN 'Μερίδιο καταστήματος (μετρητά)'
                 ELSE 'Μερίδιο καταστήματος (κάρτα)' END);
  END IF;

  -- DRIVER share: guaranteed base+km plus tip.
  IF NEW.driver_id IS NOT NULL THEN
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    pool_take := LEAST(COALESCE(pool_balance, 0), driver_base_pay);
    admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

    IF pool_take > 0 THEN
      INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
      VALUES (-pool_take, 'platform', 'driver_base_pay', NEW.id, 'Base + km paid to driver');
      UPDATE public.admin_treasury
        SET platform_pool = platform_pool - pool_take, updated_at = now()
        WHERE id = 1;
    END IF;

    IF admin_subsidy > 0 THEN
      INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
      VALUES (-admin_subsidy, 'admin', 'driver_pay_subsidy', NEW.id, 'Admin subsidy for base + km driver pay');
      UPDATE public.admin_treasury
        SET admin_balance = admin_balance - admin_subsidy, updated_at = now()
        WHERE id = 1;
    END IF;

    driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

    IF driver_share_total > 0 THEN
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, driver_share_total, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + driver_share_total,
            updated_at = now();

      INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
      VALUES (NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Base pay + km + tip', NEW.id);

      INSERT INTO public.earnings (driver_id, order_id, base_pay, tip, bonus)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, tip_amt, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );
    END IF;

    -- Cash orders: driver owes the FULL cash collected to the platform
    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, NEW.total_amount, 0);
      amount_owed := cash_collected;

      INSERT INTO public.driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share,
        amount_owed, settled
      ) VALUES (
        NEW.driver_id, NEW.id, cash_collected,
        driver_share_total, store_keeps_amt, admin_amt,
        pool_amt + store_extra, amount_owed, false
      );
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

DROP TRIGGER IF EXISTS trg_settle_order_commission ON public.orders;
CREATE TRIGGER trg_settle_order_commission
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_order_commission();

-- Source: 20260521082810_a6818158-9d3a-47ab-962d-b8ce21444fa5.sql
CREATE TABLE IF NOT EXISTS public.dispatch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source text NOT NULL DEFAULT 'cron',
  success boolean NOT NULL DEFAULT false,
  dispatched integer NOT NULL DEFAULT 0,
  expired integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error text,
  details jsonb
);

CREATE INDEX IF NOT EXISTS idx_dispatch_runs_started_at ON public.dispatch_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_runs_success ON public.dispatch_runs (success, started_at DESC);

ALTER TABLE public.dispatch_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read dispatch runs" ON public.dispatch_runs;
CREATE POLICY "Admins read dispatch runs"
ON public.dispatch_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Retain only last 14 days
CREATE OR REPLACE FUNCTION public.cleanup_dispatch_runs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.dispatch_runs WHERE started_at < now() - interval '14 days';
$$;

-- Source: 20260521084811_fa2eb970-db10-4a52-b543-7ffde094f80a.sql
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS dispatch_lead_minutes integer NOT NULL DEFAULT 8;

-- Source: 20260521085459_45f7b8fa-b965-49ed-bf78-e713fb2180ab.sql
ALTER TABLE public.store_pricing_overrides ADD COLUMN IF NOT EXISTS max_pay numeric;

-- Source: 20260521085844_05ed0db1-20d4-46fa-a254-45d71e56895e.sql
CREATE OR REPLACE FUNCTION public.settle_order_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  tip_amt numeric;
  store_extra numeric;
  store_keeps_amt numeric;
  pays_delivery boolean;
  pool_balance numeric;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  amount_owed numeric := 0;
  v_settings public.platform_settings%ROWTYPE;
  v_override public.store_pricing_overrides%ROWTYPE;
  v_base numeric;
  v_per_km numeric;
  v_min numeric;
  v_max numeric;
  v_km numeric;
  driver_base_pay numeric := 0;
  locked_payout numeric;
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

  -- Honor the payout the driver actually saw and accepted on the offer
  -- (NEW.driver_payout is locked at order/accept time, before tip).
  -- Fall back to the formula only if no locked value exists.
  locked_payout := COALESCE(NEW.driver_payout, 0);

  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    SELECT * INTO v_settings FROM public.platform_settings WHERE id = 1;
    SELECT * INTO v_override FROM public.store_pricing_overrides WHERE store_id = NEW.store_id;
    v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
    v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
    v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
    v_max    := COALESCE(v_override.max_pay,     v_settings.max_pay,     999999);
    v_km     := COALESCE(NEW.distance_km, 0);
    driver_base_pay := ROUND(LEAST(GREATEST(v_base + v_per_km * v_km, v_min), v_max)::numeric, 2);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  -- ADMIN bag
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

    INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', store_keeps_amt,
            CASE WHEN is_cash THEN 'Μερίδιο καταστήματος (μετρητά)'
                 ELSE 'Μερίδιο καταστήματος (κάρτα)' END);
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    pool_take := LEAST(COALESCE(pool_balance, 0), driver_base_pay);
    admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

    IF pool_take > 0 THEN
      INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
      VALUES (-pool_take, 'platform', 'driver_base_pay', NEW.id, 'Base + km paid to driver');
      UPDATE public.admin_treasury
        SET platform_pool = platform_pool - pool_take, updated_at = now()
        WHERE id = 1;
    END IF;

    IF admin_subsidy > 0 THEN
      INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
      VALUES (-admin_subsidy, 'admin', 'driver_pay_subsidy', NEW.id, 'Admin subsidy for base + km driver pay');
      UPDATE public.admin_treasury
        SET admin_balance = admin_balance - admin_subsidy, updated_at = now()
        WHERE id = 1;
    END IF;

    driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

    IF driver_share_total > 0 THEN
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, driver_share_total, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + driver_share_total,
            updated_at = now();

      INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
      VALUES (NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Base pay + km + tip', NEW.id);

      INSERT INTO public.earnings (driver_id, order_id, base_pay, tip, bonus)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, tip_amt, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, NEW.total_amount, 0);
      amount_owed := cash_collected;

      INSERT INTO public.driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share,
        amount_owed, settled
      ) VALUES (
        NEW.driver_id, NEW.id, cash_collected,
        driver_share_total, store_keeps_amt, admin_amt,
        pool_amt + store_extra, amount_owed, false
      );
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

-- Source: 20260521130246_5cc9a8c1-abf2-44a8-9fd0-28dfbf59e2b6.sql

-- ============================================================
-- 1) Stores: hide sensitive columns from generic authenticated users
-- ============================================================
DROP VIEW IF EXISTS public.stores_public;

DROP POLICY IF EXISTS "Authenticated users can view stores" ON public.stores;

DROP POLICY IF EXISTS "Owners view own store" ON public.stores;
CREATE POLICY "Owners view own store"
ON public.stores FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Drivers view stores for their active orders" ON public.stores;
CREATE POLICY "Drivers view stores for their active orders"
ON public.stores FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = stores.id
      AND o.driver_id = auth.uid()
      AND o.status = ANY (ARRAY['accepted','preparing','ready','arrived','picked_up']::order_status[])
  )
);

DROP POLICY IF EXISTS "Customers view stores for their active orders" ON public.stores;
CREATE POLICY "Customers view stores for their active orders"
ON public.stores FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = stores.id
      AND o.customer_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Anyone reads active stores" ON public.stores;
CREATE POLICY "Anyone reads active stores"
ON public.stores FOR SELECT
TO authenticated, anon
USING (is_active = true);

-- Column-level revoke: hide sensitive fields from REST clients (everyone is `authenticated`/`anon`)
REVOKE SELECT (commission_pct, ext_commission_pct, ext_billing_mode,
               ext_flat_fee, ext_margin_pct, suspension_reason, phone)
  ON public.stores FROM authenticated, anon;

GRANT SELECT (commission_pct, ext_commission_pct, ext_billing_mode,
              ext_flat_fee, ext_margin_pct, suspension_reason, phone)
  ON public.stores TO service_role;

-- Public-safe view used by browsing flows
CREATE VIEW public.stores_public
WITH (security_invoker = true) AS
SELECT
  id, owner_id, name, address, latitude, longitude, image_url,
  is_active, busy_mode, prep_buffer_minutes, opening_hours, holiday_dates,
  promotion_status, promotion_starts_at, promotion_ends_at,
  covers_delivery_fee, created_at, updated_at
FROM public.stores;

GRANT SELECT ON public.stores_public TO authenticated, anon;

-- SECURITY DEFINER function for legitimate access to phone/contact details
CREATE OR REPLACE FUNCTION public.get_store_contact(_store_id uuid)
RETURNS TABLE(id uuid, name text, address text, phone text,
              latitude double precision, longitude double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.address, s.phone, s.latitude, s.longitude
  FROM public.stores s
  WHERE s.id = _store_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_support_or_admin(auth.uid())
      OR s.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.store_id = s.id
          AND (o.driver_id = auth.uid() OR o.customer_id = auth.uid())
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_store_contact(uuid) TO authenticated;

-- ============================================================
-- 2) Storage: fix delivery proof bucket name
-- ============================================================
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;

DO $$ BEGIN
CREATE POLICY "Store owners view their order proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND (storage.foldername(objects.name))[1] = (o.id)::text
  )
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3) Realtime: scope broadcast channels
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='realtime' AND tablename='messages' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON realtime.messages;', r.policyname);
  END LOOP;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users read own realtime topics" ON realtime.messages;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own realtime topics"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    (realtime.topic() LIKE ('user:' || auth.uid()::text || '%'))
    OR is_support_or_admin(auth.uid())
  );
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users send to own realtime topics" ON realtime.messages;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users send to own realtime topics"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (realtime.topic() LIKE ('user:' || auth.uid()::text || '%'))
    OR is_support_or_admin(auth.uid())
  );
EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================
-- 4) Server-side place_order RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_order(
  p_store_id uuid,
  p_items jsonb,
  p_delivery_address text,
  p_delivery_latitude double precision,
  p_delivery_longitude double precision,
  p_payment_method text,
  p_tip_amount numeric,
  p_delivery_fee numeric,
  p_notes text,
  p_scheduled_for timestamptz,
  p_distance_km numeric,
  p_promo_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_promo record;
  v_order_id uuid;
  v_item jsonb;
  v_menu record;
  v_qty int;
  v_total numeric;
  v_fee numeric := COALESCE(p_delivery_fee, 0);
  v_tip numeric := GREATEST(COALESCE(p_tip_amount, 0), 0);
  v_status order_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;
  IF p_payment_method NOT IN ('cash','card') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price, mi.store_id, mi.is_available, mi.is_snoozed
      INTO v_menu
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item not found';
    END IF;
    IF v_menu.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Menu item does not belong to store';
    END IF;
    IF COALESCE(v_menu.is_available, true) = false OR COALESCE(v_menu.is_snoozed, false) = true THEN
      RAISE EXCEPTION 'Menu item unavailable: %', v_menu.name;
    END IF;
    v_subtotal := v_subtotal + (v_menu.price * v_qty);
  END LOOP;

  IF p_promo_code IS NOT NULL AND length(trim(p_promo_code)) > 0 THEN
    SELECT * INTO v_promo
      FROM public.promo_codes
      WHERE lower(code) = lower(trim(p_promo_code))
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR current_uses < max_uses)
        AND (store_id IS NULL OR store_id = p_store_id)
        AND min_order_amount <= v_subtotal
      LIMIT 1;
    IF FOUND THEN
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
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price INTO v_menu
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    INSERT INTO public.order_items (order_id, menu_item_id, name, quantity, unit_price)
    VALUES (v_order_id, v_menu.id, v_menu.name, v_qty, v_menu.price);
  END LOOP;

  IF v_promo.id IS NOT NULL THEN
    UPDATE public.promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo.id;
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(
  uuid, jsonb, text, double precision, double precision,
  text, numeric, numeric, text, timestamptz, numeric, text
) TO authenticated;


-- Source: 20260521131053_23bfb593-a238-4e21-b171-173406298b32.sql
-- Customer app configuration with draft/publish workflow
CREATE TABLE IF NOT EXISTS public.customer_app_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true), -- single-row table
  draft_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  published_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.customer_app_config ENABLE ROW LEVEL SECURITY;

-- Everyone (including anon) can read the published config (it's used on the public customer home)
DROP POLICY IF EXISTS "Anyone can read customer app config" ON public.customer_app_config;
CREATE POLICY "Anyone can read customer app config"
  ON public.customer_app_config FOR SELECT
  USING (true);

-- Only admins can update / publish
DROP POLICY IF EXISTS "Admins manage customer app config" ON public.customer_app_config;
CREATE POLICY "Admins manage customer app config"
  ON public.customer_app_config FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed with defaults matching the current hard-coded UI
INSERT INTO public.customer_app_config (id, draft_config, published_config)
VALUES (
  true,
  jsonb_build_object(
    'branding', jsonb_build_object(
      'app_name', 'Fresh Delivery',
      'city_label', 'Ιωάννινα',
      'accent_hsl', '4 90% 47%',
      'accent_dark_hsl', '4 90% 38%',
      'logo_url', null
    ),
    'tiles', jsonb_build_array(
      jsonb_build_object('label','Φαγητό','emoji','🍔','category','all'),
      jsonb_build_object('label','Πίτσα','emoji','🍕','category','Πίτσες'),
      jsonb_build_object('label','Καφές','emoji','☕','category','Καφέδες'),
      jsonb_build_object('label','Γλυκά','emoji','🍰','category','Γλυκά')
    ),
    'promos', jsonb_build_array(
      jsonb_build_object('tag','NEW','title','Δωρεάν παράδοση','subtitle','στην πρώτη σου παραγγελία','code','WELCOME','gradient','hero','enabled',true),
      jsonb_build_object('tag','−20%','title','Έκπτωση 20%','subtitle','στις 3 πρώτες παραγγελίες','code','NEW20','gradient','dark','enabled',true),
      jsonb_build_object('tag','FLASH','title','Δωρεάν γλυκό','subtitle','σε παραγγελίες άνω των 15€','code','SWEET','gradient','hero','enabled',true)
    ),
    'sections', jsonb_build_object(
      'show_tiles', true,
      'show_promos', true,
      'show_categories', true,
      'show_promoted', true,
      'show_nearby', true
    )
  ),
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- After insert: publish the seeded draft so the live app immediately gets defaults
UPDATE public.customer_app_config
SET published_config = draft_config, published_at = now()
WHERE id = true AND published_config = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.touch_customer_app_config()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_customer_app_config ON public.customer_app_config;
CREATE TRIGGER trg_touch_customer_app_config
  BEFORE UPDATE ON public.customer_app_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_customer_app_config();

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_app_config; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Source: 20260521141006_cf00a2be-3a1e-477b-b608-be69ef9bbfbf.sql

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

DROP POLICY IF EXISTS "Admins read aade config" ON aade_platform_config;
CREATE POLICY "Admins read aade config" ON public.aade_platform_config
  FOR SELECT USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "Admins write aade config" ON aade_platform_config;
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
DROP POLICY IF EXISTS "Admins read aade reports" ON aade_delivery_reports;
CREATE POLICY "Admins read aade reports" ON public.aade_delivery_reports
  FOR SELECT USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "Admins manage aade reports" ON aade_delivery_reports;
CREATE POLICY "Admins manage aade reports" ON public.aade_delivery_reports
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_aade_config_updated ON public.aade_platform_config;
CREATE TRIGGER trg_aade_config_updated BEFORE UPDATE ON public.aade_platform_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_aade_reports_updated ON public.aade_delivery_reports;
CREATE TRIGGER trg_aade_reports_updated BEFORE UPDATE ON public.aade_delivery_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed singleton row
INSERT INTO public.aade_platform_config (mydata_environment) VALUES ('production')
  ON CONFLICT DO NOTHING;


-- Source: 20260521141746_e1ecfc74-912a-48e6-ad71-125272697647.sql

-- Helper: does this user have an active order at this store (as driver)?
CREATE OR REPLACE FUNCTION public.driver_has_active_order_at_store(_user uuid, _store uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = _store
      AND o.driver_id = _user
      AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
  );
$$;

-- Helper: does this user have any order at this store (as customer)?
CREATE OR REPLACE FUNCTION public.customer_has_order_at_store(_user uuid, _store uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = _store AND o.customer_id = _user
  );
$$;

REVOKE EXECUTE ON FUNCTION public.driver_has_active_order_at_store(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_has_order_at_store(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_has_active_order_at_store(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_has_order_at_store(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Drivers view stores for their active orders" ON public.stores;
DROP POLICY IF EXISTS "Customers view stores for their active orders" ON public.stores;

DROP POLICY IF EXISTS "Drivers view stores for their active orders" ON stores;
CREATE POLICY "Drivers view stores for their active orders" ON public.stores
  FOR SELECT USING (public.driver_has_active_order_at_store(auth.uid(), id));

DROP POLICY IF EXISTS "Customers view stores for their active orders" ON stores;
CREATE POLICY "Customers view stores for their active orders" ON public.stores
  FOR SELECT USING (public.customer_has_order_at_store(auth.uid(), id));


-- Source: 20260521142148_12a4d05e-7ba2-429e-af59-dcd4acfb558a.sql

-- Prevent duplicate reports per order
CREATE UNIQUE INDEX IF NOT EXISTS aade_delivery_reports_order_id_uniq
  ON public.aade_delivery_reports(order_id)
  WHERE order_id IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Trigger function: when order moves to delivered, fire-and-forget the submit function
CREATE OR REPLACE FUNCTION public.trg_aade_autosubmit_on_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF NEW.status::text <> 'delivered' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = 'delivered' THEN
    RETURN NEW;
  END IF;

  SELECT platform_reporting_enabled INTO v_enabled
  FROM public.aade_platform_config
  LIMIT 1;
  IF COALESCE(v_enabled, false) = false THEN
    RETURN NEW;
  END IF;

  -- Skip if already sent
  IF EXISTS (
    SELECT 1 FROM public.aade_delivery_reports
    WHERE order_id = NEW.id AND status = 'sent'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://<YOUR_PROJECT>.supabase.co/functions/v1/aade-submit-delivery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<SUPABASE_ANON_OR_SERVICE_JWT>'
    ),
    body := jsonb_build_object('order_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block order updates due to reporting failures
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_aade_autosubmit ON public.orders;
CREATE TRIGGER orders_aade_autosubmit
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_aade_autosubmit_on_delivered();


-- Source: 20260521180854_0fa6d663-2908-432e-b59b-fb15e34cc7ab.sql
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
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;
  IF p_payment_method NOT IN ('cash','card') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price, mi.store_id, mi.is_available, mi.is_snoozed
      INTO v_menu
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item not found';
    END IF;
    IF v_menu.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Menu item does not belong to store';
    END IF;
    IF COALESCE(v_menu.is_available, true) = false OR COALESCE(v_menu.is_snoozed, false) = true THEN
      RAISE EXCEPTION 'Menu item unavailable: %', v_menu.name;
    END IF;
    v_subtotal := v_subtotal + (v_menu.price * v_qty);
  END LOOP;

  IF p_promo_code IS NOT NULL AND length(trim(p_promo_code)) > 0 THEN
    SELECT * INTO v_promo
      FROM public.promo_codes
      WHERE lower(code) = lower(trim(p_promo_code))
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR current_uses < max_uses)
        AND (store_id IS NULL OR store_id = p_store_id)
        AND min_order_amount <= v_subtotal
      LIMIT 1;
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
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price INTO v_menu
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    INSERT INTO public.order_items (order_id, menu_item_id, name, quantity, unit_price)
    VALUES (v_order_id, v_menu.id, v_menu.name, v_qty, v_menu.price);
  END LOOP;

  IF v_promo_id IS NOT NULL THEN
    UPDATE public.promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
  END IF;

  RETURN v_order_id;
END;
$function$;

-- Source: 20260522033022_1bca7d6a-34e5-4f1b-9a00-adec9d70bd62.sql

-- Drop 4 of the 6 staggered dispatch jobs; keep 2 (0s and 30s offset).
DO $$ BEGIN SELECT cron.unschedule('auto-dispatch-10s-10'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN SELECT cron.unschedule('auto-dispatch-10s-20'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN SELECT cron.unschedule('auto-dispatch-10s-40'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN SELECT cron.unschedule('auto-dispatch-10s-50'); EXCEPTION WHEN others THEN NULL; END $$;

-- Rebuild remaining two to fire once at :00 and once at :30 (instead of every 10s).
DO $$ BEGIN SELECT cron.unschedule('auto-dispatch-10s-0'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN SELECT cron.unschedule('auto-dispatch-10s-30'); EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'auto-dispatch-30s-0',
  '* * * * *',
  $$SELECT net.http_post(
      url:='https://<YOUR_PROJECT>.supabase.co/functions/v1/auto-dispatch',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_ANON_OR_SERVICE_JWT>"}'::jsonb,
      body:='{"source":"cron"}'::jsonb
   ) AS request_id;$$
);

SELECT cron.schedule(
  'auto-dispatch-30s-30',
  '* * * * *',
  $$SELECT pg_sleep(30); SELECT net.http_post(
      url:='https://<YOUR_PROJECT>.supabase.co/functions/v1/auto-dispatch',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_ANON_OR_SERVICE_JWT>"}'::jsonb,
      body:='{"source":"cron"}'::jsonb
   ) AS request_id;$$
);


-- Source: 20260523000945_fec21748-21d3-4f1c-981d-811711554040.sql

CREATE INDEX IF NOT EXISTS idx_orders_dispatch_candidates
  ON public.orders (status, predicted_ready_at, created_at)
  WHERE driver_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_offers_status_expires
  ON public.pending_offers (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_pending_offers_order
  ON public.pending_offers (order_id);

CREATE INDEX IF NOT EXISTS idx_driver_offer_events_recent
  ON public.driver_offer_events (action, created_at);

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver
  ON public.driver_locations (driver_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_runs_started
  ON public.dispatch_runs (started_at DESC);


-- Source: 20260523001424_c03e4d1e-e2ed-4f73-970c-fb3c3ecf1ef2.sql

-- One-time cleanup: drop everything older than 3 days.
DELETE FROM public.dispatch_runs
WHERE started_at < now() - INTERVAL '3 days';

-- Reclaim space.
-- (VACUUM cannot run inside a migration transaction; skip and let autovacuum handle it.)

-- Scheduled daily prune so the table stays small.
CREATE OR REPLACE FUNCTION public.prune_dispatch_runs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.dispatch_runs
  WHERE started_at < now() - INTERVAL '3 days';
$$;

REVOKE ALL ON FUNCTION public.prune_dispatch_runs() FROM PUBLIC, anon, authenticated;

-- Replace any prior schedule so we don't double-schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('prune-dispatch-runs-daily');
EXCEPTION WHEN OTHERS THEN
  -- job didn't exist, ignore
  NULL;
END $$;

SELECT cron.schedule(
  'prune-dispatch-runs-daily',
  '17 3 * * *',  -- 03:17 UTC every day
  $$ SELECT public.prune_dispatch_runs(); $$
);


