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