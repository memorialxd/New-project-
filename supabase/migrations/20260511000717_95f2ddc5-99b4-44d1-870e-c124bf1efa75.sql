
-- 1. Seed driver pool to €1000 baseline (only top up if below)
UPDATE public.admin_treasury
SET platform_pool = GREATEST(platform_pool, 1000),
    lifetime_driver_topup = lifetime_driver_topup + GREATEST(1000 - platform_pool, 0),
    updated_at = now()
WHERE id = 1;

INSERT INTO public.admin_treasury_ledger (amount, bag, type, description)
SELECT 1000, 'platform', 'seed', 'Initial driver pool seed €1000'
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_treasury_ledger WHERE type = 'seed' AND bag = 'platform'
);

-- 2. Rewrite settle_order_commission: pay pool bonus on cash too
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  store_extra numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  pool_take numeric;
  is_cash boolean;
  s RECORD;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  is_cash      := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt    := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt     := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  store_extra  := COALESCE((split->>'store_extra_commission')::numeric, 0);
  pays_delivery := COALESCE((split->>'store_pays_delivery')::boolean, false);

  -- 1) Admin bag in (5%)
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 2) Pool top-up in (10%)
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 3) Extra store commission (>15%) -> pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 4) Driver pool BONUS (always paid to assigned driver, including cash)
  IF NEW.driver_id IS NOT NULL THEN
    bonus_info := public.compute_driver_pool_bonus(NEW.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    subsidy_amt := COALESCE((bonus_info->>'admin_subsidy')::numeric, 0);

    IF bonus_amt > 0 THEN
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_take := LEAST(pool_balance, GREATEST(bonus_amt - subsidy_amt, 0));
      IF pool_take > 0 THEN
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_take, updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_bonus', NEW.id, 'Pool bonus paid to driver');
      END IF;

      IF subsidy_amt > 0 THEN
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - subsidy_amt, updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-subsidy_amt, 'admin', 'pool_subsidy', NEW.id, 'Admin subsidy to honor min driver pay');
      END IF;

      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();
    END IF;
  END IF;

  -- 5) Delivery fee to driver wallet — only for non-cash (cash drivers already collected it)
  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND NOT is_cash THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  -- 6) Pool low alert
  SELECT pool_alert_enabled, low_pool_threshold INTO s FROM public.platform_settings WHERE id = 1;
  IF s.pool_alert_enabled THEN
    SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    IF pool_balance < s.low_pool_threshold THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'pool_low_alert' AND created_at > now() - interval '24 hours'
      ) THEN
        INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, description, metadata)
        VALUES (NEW.driver_id, 'system', 'pool_low_alert', 'platform_pool',
                'Driver pool dropped below low threshold',
                jsonb_build_object('balance', pool_balance, 'threshold', s.low_pool_threshold));
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt + pool_amt + store_extra;
  NEW.driver_payout := (CASE WHEN is_cash THEN 0 ELSE delivery_amt END) + bonus_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.store_charge := admin_amt + pool_amt + store_extra + (CASE WHEN pays_delivery THEN delivery_amt ELSE 0 END);

  RETURN NEW;
END;
$function$;

-- 3. Backfill: re-settle delivered orders that have €0 driver_payout AND a driver assigned
DO $$
DECLARE
  r RECORD;
  bonus_info jsonb;
  bonus_amt numeric;
  pool_balance numeric;
  pool_take numeric;
BEGIN
  FOR r IN
    SELECT id, driver_id, payment_method, delivery_fee
    FROM public.orders
    WHERE status = 'delivered'
      AND driver_id IS NOT NULL
      AND driver_pool_bonus = 0
      AND commission_settled_at IS NOT NULL
  LOOP
    bonus_info := public.compute_driver_pool_bonus(r.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    IF bonus_amt > 0 THEN
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_take := LEAST(pool_balance, bonus_amt);
      IF pool_take > 0 THEN
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_take, updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_bonus', r.id, 'Backfill bonus for previously unpaid order');
      END IF;
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (r.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();
      UPDATE public.orders
        SET driver_pool_bonus = bonus_amt,
            driver_payout = driver_payout + bonus_amt
        WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
