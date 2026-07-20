-- 1. Settings: ensure floors are present
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS driver_pool_pct_of_subtotal numeric NOT NULL DEFAULT 10;

UPDATE public.platform_settings
  SET admin_share_pct = GREATEST(COALESCE(admin_share_pct, 0), 5),
      driver_pool_pct_of_subtotal = GREATEST(COALESCE(driver_pool_pct_of_subtotal, 0), 10),
      default_commission_pct = GREATEST(COALESCE(default_commission_pct, 0), 15)
  WHERE id = 1;

-- Floor trigger on settings
CREATE OR REPLACE FUNCTION public.enforce_commission_floors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.admin_share_pct < 5 THEN NEW.admin_share_pct := 5; END IF;
  IF NEW.driver_pool_pct_of_subtotal < 10 THEN NEW.driver_pool_pct_of_subtotal := 10; END IF;
  IF NEW.default_commission_pct < (NEW.admin_share_pct + NEW.driver_pool_pct_of_subtotal) THEN
    NEW.default_commission_pct := NEW.admin_share_pct + NEW.driver_pool_pct_of_subtotal;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_commission_floors ON public.platform_settings;
CREATE TRIGGER trg_enforce_commission_floors
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_commission_floors();

-- Per-store floor: commission_pct cannot drop below 15
CREATE OR REPLACE FUNCTION public.enforce_store_commission_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.commission_pct IS NOT NULL AND NEW.commission_pct < 15 THEN
    NEW.commission_pct := 15;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_store_commission_floor ON public.stores;
CREATE TRIGGER trg_enforce_store_commission_floor
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.enforce_store_commission_floor();

-- 2. Stores: covers_delivery_fee toggle
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS covers_delivery_fee boolean NOT NULL DEFAULT false;

-- 3. Track whether an order has been settled (to keep the trigger idempotent)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS commission_settled_at timestamp with time zone;

-- 4. Compute helper
CREATE OR REPLACE FUNCTION public.compute_order_split(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders%ROWTYPE;
  s public.stores%ROWTYPE;
  ps public.platform_settings%ROWTYPE;
  food_subtotal numeric;
  total_comm_pct numeric;
  admin_pct numeric;
  pool_pct numeric;
  store_extra_pct numeric;
  delivery_fee numeric;
  store_pays_delivery boolean;
  res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.stores WHERE id = o.store_id;
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;

  delivery_fee := COALESCE(o.delivery_fee, 0);
  food_subtotal := GREATEST(COALESCE(o.total_amount, 0) - delivery_fee - COALESCE(o.tip_amount, 0), 0);

  total_comm_pct := GREATEST(COALESCE(s.commission_pct, ps.default_commission_pct, 15), 15);
  admin_pct := GREATEST(COALESCE(ps.admin_share_pct, 5), 5);
  pool_pct := GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10);
  store_extra_pct := GREATEST(total_comm_pct - admin_pct - pool_pct, 0);

  store_pays_delivery := COALESCE(s.covers_delivery_fee, false);

  res := jsonb_build_object(
    'food_subtotal', food_subtotal,
    'delivery_fee', delivery_fee,
    'tip_amount', COALESCE(o.tip_amount, 0),
    'total_commission_pct', total_comm_pct,
    'admin_pct', admin_pct,
    'driver_pool_pct', pool_pct,
    'store_extra_commission_pct', store_extra_pct,
    'admin_amount', round(food_subtotal * admin_pct / 100, 2),
    'driver_pool_amount', round(food_subtotal * pool_pct / 100, 2),
    'store_extra_commission', round(food_subtotal * store_extra_pct / 100, 2),
    'store_keeps', round(food_subtotal * (100 - total_comm_pct) / 100, 2),
    'store_pays_delivery', store_pays_delivery,
    'driver_delivery_fee', delivery_fee,
    'driver_tip', COALESCE(o.tip_amount, 0)
  );
  RETURN res;
END;
$$;

-- 5. Settle trigger
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
  store_extra numeric;
  pays_delivery boolean;
BEGIN
  -- Only settle on transition to delivered, once
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  admin_amt    := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt     := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  store_extra  := COALESCE((split->>'store_extra_commission')::numeric, 0);
  pays_delivery := COALESCE((split->>'store_pays_delivery')::boolean, false);

  -- Admin bag
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share of food subtotal');

    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Driver pool
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up share');

    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Extra store commission (if store has commission_pct > 15) -> platform pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Extra store commission above 15%');

    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Pay delivery fee to driver (cash orders are settled separately via driver_cash_debts)
  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND COALESCE(NEW.payment_method, 'card') <> 'cash' THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  -- Persist
  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt + pool_amt + store_extra;
  NEW.driver_payout := delivery_amt;
  NEW.store_charge := admin_amt + pool_amt + store_extra + (CASE WHEN pays_delivery THEN delivery_amt ELSE 0 END);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_order_commission ON public.orders;
CREATE TRIGGER trg_settle_order_commission
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.settle_order_commission();

-- 6. Ensure unique driver_id on driver_wallets so the ON CONFLICT works
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='driver_wallets_driver_id_key'
  ) THEN
    ALTER TABLE public.driver_wallets ADD CONSTRAINT driver_wallets_driver_id_key UNIQUE (driver_id);
  END IF;
END $$;