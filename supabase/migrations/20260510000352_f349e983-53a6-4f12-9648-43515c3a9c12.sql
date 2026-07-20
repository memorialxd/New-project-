-- 1. New tunable settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pool_healthy_threshold numeric NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS pool_critical_threshold numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS pool_low_multiplier numeric NOT NULL DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS pool_critical_multiplier numeric NOT NULL DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS max_pay numeric NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS subsidize_min_pay boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pool_alert_enabled boolean NOT NULL DEFAULT true;

-- 2. New order column for the per-order bonus paid from pool
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS driver_pool_bonus numeric NOT NULL DEFAULT 0;

-- 3. Helper: compute the pool bonus for an order (read-only, idempotent preview)
CREATE OR REPLACE FUNCTION public.compute_driver_pool_bonus(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  o RECORD;
  pool numeric;
  raw_amt numeric;
  clamped numeric;
  mult numeric;
  health text;
  final_amt numeric;
  subsidy numeric := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT base_pay, per_km_rate, min_pay, max_pay,
         pool_healthy_threshold, low_pool_threshold, pool_critical_threshold,
         pool_low_multiplier, pool_critical_multiplier,
         subsidize_min_pay
    INTO s FROM public.platform_settings WHERE id = 1;

  SELECT COALESCE(platform_pool, 0) INTO pool FROM public.admin_treasury WHERE id = 1;

  -- Health multiplier
  IF pool >= s.pool_healthy_threshold THEN
    mult := 1.0; health := 'healthy';
  ELSIF pool >= s.low_pool_threshold THEN
    mult := 1.0; health := 'normal';
  ELSIF pool >= s.pool_critical_threshold THEN
    mult := s.pool_low_multiplier; health := 'low';
  ELSE
    mult := s.pool_critical_multiplier; health := 'critical';
  END IF;

  -- base + per_km * distance, clamped to [min_pay, max_pay], then * health multiplier,
  -- but never below min_pay (admin's promise).
  raw_amt  := COALESCE(s.base_pay,0) + COALESCE(s.per_km_rate,0) * COALESCE(o.distance_km,0);
  clamped  := LEAST(GREATEST(raw_amt, s.min_pay), s.max_pay);
  final_amt := GREATEST(clamped * mult, s.min_pay);

  -- Pool insolvency guard
  IF final_amt > pool THEN
    IF s.subsidize_min_pay AND final_amt >= s.min_pay THEN
      subsidy := LEAST(s.min_pay, final_amt) - LEAST(pool, final_amt);
      subsidy := GREATEST(subsidy, 0);
      final_amt := LEAST(pool, final_amt) + subsidy;
    ELSE
      final_amt := GREATEST(pool, 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'pool_balance',  pool,
    'health',        health,
    'multiplier',    mult,
    'raw',           round(raw_amt::numeric, 2),
    'clamped',       round(clamped::numeric, 2),
    'final',         round(final_amt::numeric, 2),
    'admin_subsidy', round(subsidy::numeric, 2),
    'distance_km',   COALESCE(o.distance_km, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_driver_pool_bonus(uuid) TO authenticated;

-- 4. Rewrite settle_order_commission so on delivery the driver also receives a pool bonus
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
  s RECORD;
BEGIN
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

  -- 1) Admin bag in
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 2) Pool top-up in
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 3) Extra store commission -> pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 4) Pool bonus OUT to driver (only for assigned, non-cash orders)
  IF NEW.driver_id IS NOT NULL AND COALESCE(NEW.payment_method, 'card') <> 'cash' THEN
    bonus_info := public.compute_driver_pool_bonus(NEW.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    subsidy_amt := COALESCE((bonus_info->>'admin_subsidy')::numeric, 0);

    IF bonus_amt > 0 THEN
      -- Withdraw from pool (capped at available balance)
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_balance := LEAST(pool_balance, bonus_amt - subsidy_amt);
      IF pool_balance > 0 THEN
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_balance,
              updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_balance, 'platform', 'driver_bonus', NEW.id, 'Pool bonus paid to driver');
      END IF;

      -- Subsidy from admin bag if enabled and needed
      IF subsidy_amt > 0 THEN
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - subsidy_amt,
              updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-subsidy_amt, 'admin', 'pool_subsidy', NEW.id, 'Admin subsidy to honor min driver pay');
      END IF;

      -- Credit driver wallet
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();
    END IF;
  END IF;

  -- 5) Delivery fee to driver (existing behavior)
  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND COALESCE(NEW.payment_method, 'card') <> 'cash' THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  -- 6) Pool health alert (de-duped per day in admin_audit_log)
  SELECT pool_alert_enabled, low_pool_threshold INTO s FROM public.platform_settings WHERE id = 1;
  IF s.pool_alert_enabled THEN
    SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    IF pool_balance < s.low_pool_threshold THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'pool_low_alert'
          AND created_at > now() - interval '24 hours'
      ) THEN
        INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, description, metadata)
        VALUES (NEW.driver_id, 'system', 'pool_low_alert', 'platform_pool',
                'Driver pool dropped below low threshold',
                jsonb_build_object('balance', pool_balance, 'threshold', s.low_pool_threshold));
      END IF;
    END IF;
  END IF;

  -- Persist
  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt + pool_amt + store_extra;
  NEW.driver_payout := delivery_amt + bonus_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.store_charge := admin_amt + pool_amt + store_extra + (CASE WHEN pays_delivery THEN delivery_amt ELSE 0 END);

  RETURN NEW;
END;
$function$;