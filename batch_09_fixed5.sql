-- Source: 20260427000405_9207d734-be2b-4845-b8e9-161e0a4c66a3.sql
CREATE OR REPLACE FUNCTION public.settle_order_money_bags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_food_total numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_min_pay numeric;
  v_settings platform_settings%ROWTYPE;
  v_commission_pct numeric;
  v_admin_share_pct numeric;
  v_store_override numeric;
  v_override_table numeric;
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_is_external boolean;
  v_store_charge numeric;
  v_base numeric;
  v_label text;
  v_cash_owed numeric;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM store_wallet_ledger
    WHERE order_id = NEW.id AND type IN ('order_earning','external_charge')
  ) THEN
    RETURN NEW;
  END IF;

  v_food_total   := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip          := COALESCE(NEW.tip_amount, 0);
  v_store_charge := COALESCE(NEW.store_charge, 0);
  v_is_cash      := (NEW.payment_method = 'cash');
  v_is_external  := (COALESCE(NEW.source, 'in_app') <> 'in_app');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay         := COALESCE(v_settings.min_pay, 3);
  v_admin_share_pct := COALESCE(v_settings.admin_share_pct, 33.33);

  -- Per-store override: stores.commission_pct first, then store_pricing_overrides
  SELECT commission_pct INTO v_store_override FROM stores WHERE id = NEW.store_id;
  SELECT commission_pct INTO v_override_table FROM store_pricing_overrides WHERE store_id = NEW.store_id;
  v_commission_pct := COALESCE(v_store_override, v_override_table, v_settings.default_commission_pct, 15);

  v_base := CASE WHEN v_is_external THEN v_store_charge ELSE v_food_total END;

  v_total_commission := ROUND(v_base * (v_commission_pct / 100.0), 2);
  v_admin_cut        := ROUND(v_total_commission * (v_admin_share_pct / 100.0), 2);
  v_platform_cut     := v_total_commission - v_admin_cut;
  v_store_share      := v_base - v_total_commission;

  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target        := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  v_label := CASE WHEN v_is_external THEN UPPER(NEW.source) ELSE 'in-app' END;

  -- STORE WALLET
  IF v_is_external THEN
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, -v_store_charge, 0)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance - v_store_charge,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'external_charge', -v_store_charge,
            v_label || ' delivery fee (' || COALESCE(NEW.external_ref, NEW.id::text) || ')');
  ELSE
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, v_store_share, v_store_share)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance + v_store_share,
          lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
            'Order ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' (' || (100 - v_commission_pct) || '% of ' || v_food_total || ')');
  END IF;

  -- ADMIN TREASURY
  UPDATE admin_treasury
    SET admin_balance            = admin_balance + v_admin_cut,
        platform_pool            = platform_pool + v_platform_cut,
        lifetime_admin_earned    = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup    = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut,
          'Admin ' || v_admin_share_pct || '% of ' || v_commission_pct || '% [' || v_label || ']');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          'Platform pool [' || v_label || ']'
          || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup,
            'Driver fair-pay top-up [' || v_label || ']');
  END IF;

  -- DRIVER WALLET (always credit fair pay, even on cash)
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance)
    VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay [' || v_label || '] (' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- CASH (simplified): driver hands ALL cash to admin
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    IF v_is_external THEN
      v_cash_owed := v_food_total;
    ELSE
      v_cash_owed := v_food_total + v_delivery_fee;
    END IF;

    IF v_cash_owed > 0 THEN
      INSERT INTO driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share, amount_owed
      ) VALUES (
        NEW.driver_id, NEW.id, v_cash_owed,
        0,
        CASE WHEN v_is_external THEN 0 ELSE v_store_share END,
        v_admin_cut,
        GREATEST(v_platform_cut, 0),
        v_cash_owed
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Source: 20260427001621_1a7c870e-574a-414d-b689-4931331f6398.sql
-- =========================================================
-- 1) MONTHLY REPORTS ARCHIVE
-- =========================================================
CREATE TABLE IF NOT EXISTS public.monthly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  admin_earned numeric NOT NULL DEFAULT 0,
  platform_earned numeric NOT NULL DEFAULT 0,
  driver_topup_total numeric NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  delivered_revenue numeric NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_by uuid,
  closed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage monthly reports" ON public.monthly_reports;
CREATE POLICY "Admins manage monthly reports"
  ON public.monthly_reports
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_monthly_reports_period ON public.monthly_reports(period_start DESC);

-- =========================================================
-- 2) NEW SETTLE TRIGGER — admin = 5% of delivery_fee
-- =========================================================
CREATE OR REPLACE FUNCTION public.settle_order_money_bags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_food_total numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_min_pay numeric;
  v_settings platform_settings%ROWTYPE;
  v_commission_pct numeric;
  v_store_override numeric;
  v_override_table numeric;
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_is_external boolean;
  v_store_charge numeric;
  v_base numeric;
  v_label text;
  v_cash_owed numeric;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM store_wallet_ledger
    WHERE order_id = NEW.id AND type IN ('order_earning','external_charge')
  ) THEN
    RETURN NEW;
  END IF;

  v_food_total   := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip          := COALESCE(NEW.tip_amount, 0);
  v_store_charge := COALESCE(NEW.store_charge, 0);
  v_is_cash      := (NEW.payment_method = 'cash');
  v_is_external  := (COALESCE(NEW.source, 'in_app') <> 'in_app');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay := COALESCE(v_settings.min_pay, 3);

  SELECT commission_pct INTO v_store_override FROM stores WHERE id = NEW.store_id;
  SELECT commission_pct INTO v_override_table FROM store_pricing_overrides WHERE store_id = NEW.store_id;
  v_commission_pct := COALESCE(v_store_override, v_override_table, v_settings.default_commission_pct, 15);

  v_base := CASE WHEN v_is_external THEN v_store_charge ELSE v_food_total END;

  -- ADMIN: always 5% of delivery_fee (guaranteed per-order profit)
  v_admin_cut := ROUND(v_delivery_fee * 0.05, 2);

  -- STORE COMMISSION on food → all goes to platform pool
  v_total_commission := ROUND(v_base * (v_commission_pct / 100.0), 2);
  v_platform_cut     := v_total_commission;
  v_store_share      := v_base - v_total_commission;

  -- Fair-pay top-up comes out of platform pool (not admin)
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target        := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  v_label := CASE WHEN v_is_external THEN UPPER(NEW.source) ELSE 'in-app' END;

  -- STORE WALLET
  IF v_is_external THEN
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, -v_store_charge, 0)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance - v_store_charge,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'external_charge', -v_store_charge,
            v_label || ' delivery fee (' || COALESCE(NEW.external_ref, NEW.id::text) || ')');
  ELSE
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, v_store_share, v_store_share)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance + v_store_share,
          lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
            'Order ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' (' || (100 - v_commission_pct) || '% of ' || v_food_total || ')');
  END IF;

  -- ADMIN TREASURY
  UPDATE admin_treasury
    SET admin_balance            = admin_balance + v_admin_cut,
        platform_pool            = platform_pool + v_platform_cut,
        lifetime_admin_earned    = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup    = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut,
          '5% of delivery fee (' || v_delivery_fee || '€) [' || v_label || ']');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          'Store commission ' || v_commission_pct || '% [' || v_label || ']'
          || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup,
            'Driver fair-pay top-up [' || v_label || ']');
  END IF;

  -- DRIVER WALLET (always credit fair pay)
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance)
    VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay [' || v_label || '] (' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- CASH: driver hands all cash to admin (manual settle)
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    IF v_is_external THEN
      v_cash_owed := v_food_total;
    ELSE
      v_cash_owed := v_food_total + v_delivery_fee;
    END IF;

    IF v_cash_owed > 0 THEN
      INSERT INTO driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share, amount_owed
      ) VALUES (
        NEW.driver_id, NEW.id, v_cash_owed,
        0,
        CASE WHEN v_is_external THEN 0 ELSE v_store_share END,
        v_admin_cut,
        GREATEST(v_platform_cut, 0),
        v_cash_owed
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================
-- 3) MONTHLY CLOSE — admin only
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_close_month(p_period_start date DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start date;
  v_end date;
  v_treasury admin_treasury%ROWTYPE;
  v_admin_earned numeric := 0;
  v_platform_earned numeric := 0;
  v_driver_topup numeric := 0;
  v_orders_count integer := 0;
  v_revenue numeric := 0;
  v_report_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can close the month';
  END IF;

  v_start := COALESCE(p_period_start, date_trunc('month', now())::date);
  v_end := (v_start + interval '1 month')::date;

  SELECT * INTO v_treasury FROM admin_treasury WHERE id = 1;

  SELECT
    COALESCE(SUM(CASE WHEN bag = 'admin' AND type = 'admin_fee' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN bag = 'platform' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'driver_topup' THEN -amount ELSE 0 END), 0)
  INTO v_admin_earned, v_platform_earned, v_driver_topup
  FROM admin_treasury_ledger
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
  INTO v_orders_count, v_revenue
  FROM orders
  WHERE status = 'delivered'
    AND updated_at >= v_start AND updated_at < v_end;

  INSERT INTO monthly_reports (
    period_start, period_end, admin_earned, platform_earned,
    driver_topup_total, orders_count, delivered_revenue,
    snapshot, closed_by
  ) VALUES (
    v_start, v_end, v_admin_earned, v_platform_earned,
    v_driver_topup, v_orders_count, v_revenue,
    jsonb_build_object(
      'admin_balance_before', v_treasury.admin_balance,
      'platform_pool_before', v_treasury.platform_pool,
      'lifetime_admin_earned', v_treasury.lifetime_admin_earned,
      'lifetime_platform_earned', v_treasury.lifetime_platform_earned
    ),
    auth.uid()
  ) RETURNING id INTO v_report_id;

  -- Reset bag balances to 0 (lifetime totals untouched)
  UPDATE admin_treasury
    SET admin_balance = 0,
        platform_pool = 0,
        updated_at = now()
    WHERE id = 1;

  -- Log on ledger so the reset is traceable
  INSERT INTO admin_treasury_ledger (type, bag, amount, description)
  VALUES ('month_close', 'admin', -v_treasury.admin_balance,
          'Month closed (' || v_start || ' → ' || v_end || ')'),
         ('month_close', 'platform', -v_treasury.platform_pool,
          'Month closed (' || v_start || ' → ' || v_end || ')');

  PERFORM log_admin_action('close_month', 'treasury', v_report_id::text,
    'Closed month ' || v_start::text,
    jsonb_build_object('admin_earned', v_admin_earned, 'platform_earned', v_platform_earned));

  RETURN v_report_id;
END;
$function$;

-- =========================================================
-- 4) CUSTOM ORDER RPC (admin/support quick form)
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_custom_order(
  p_store_id uuid,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_distance_km numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_items_summary text DEFAULT NULL,
  p_delivery_fee_override numeric DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_settings platform_settings%ROWTYPE;
  v_fee numeric;
  v_combined_notes text;
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support or admin can create custom orders';
  END IF;
  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total cannot be negative';
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;

  IF p_delivery_fee_override IS NOT NULL THEN
    v_fee := p_delivery_fee_override;
  ELSE
    v_fee := GREATEST(
      COALESCE(v_settings.min_pay, 3),
      COALESCE(v_settings.base_pay, 3) + COALESCE(v_settings.per_km_rate, 0.5) * COALESCE(p_distance_km, 0)
    );
  END IF;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END
  );

  INSERT INTO orders (
    store_id, status, source,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout, platform_profit
  ) VALUES (
    p_store_id, 'placed', 'manual',
    p_total_amount, v_fee, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, p_payment_method,
    0, v_fee, 0
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (v_order_id, COALESCE(p_items_summary, 'Custom order'), 1, p_total_amount);

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_custom_order', 'order', v_order_id::text,
      'Custom order ' || p_total_amount || '€ → ' || COALESCE(p_delivery_address, 'no address'),
      jsonb_build_object('payment_method', p_payment_method, 'fee', v_fee)
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- Source: 20260428001446_c00902a1-0da9-453b-a8d9-5f21e8866120.sql
-- =====================================================================
-- MONEY ENGINE REVAMP
-- 1. Tiered commission table
-- 2. Helper function to resolve commission %
-- 3. Rewrite settle_order_money_bags:
--      - driver pay = delivery_fee + tip + top-up to min_pay
--      - admin = 5% of delivery_fee (unchanged)
--      - store commission via tiers (or override)
--      - all flows funnel through admin_treasury / store_wallets / driver_wallets
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.commission_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_amount numeric NOT NULL DEFAULT 0,
  max_amount numeric,                       -- NULL = open upper bound
  commission_pct numeric NOT NULL,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commission_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage commission tiers" ON public.commission_tiers;
CREATE POLICY "Admins manage commission tiers"
ON public.commission_tiers FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated read commission tiers" ON public.commission_tiers;
CREATE POLICY "Authenticated read commission tiers"
ON public.commission_tiers FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS commission_tiers_updated_at ON public.commission_tiers;
CREATE TRIGGER commission_tiers_updated_at
BEFORE UPDATE ON public.commission_tiers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: one tier matching current default so existing behavior is preserved
INSERT INTO public.commission_tiers (min_amount, max_amount, commission_pct, label)
SELECT 0, NULL, COALESCE((SELECT default_commission_pct FROM platform_settings WHERE id=1), 15), 'Default (all orders)'
WHERE NOT EXISTS (SELECT 1 FROM public.commission_tiers);

-- ---------------------------------------------------------------------
-- Helper: resolve commission pct for a store + food total
-- Priority: store override > tier match > platform default > 15
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_commission_pct(p_store_id uuid, p_food_total numeric)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_store_override numeric;
  v_table_override numeric;
  v_tier_pct numeric;
  v_default numeric;
BEGIN
  SELECT commission_pct INTO v_store_override FROM stores WHERE id = p_store_id;
  IF v_store_override IS NOT NULL THEN RETURN v_store_override; END IF;

  SELECT commission_pct INTO v_table_override FROM store_pricing_overrides WHERE store_id = p_store_id;
  IF v_table_override IS NOT NULL THEN RETURN v_table_override; END IF;

  SELECT commission_pct INTO v_tier_pct
  FROM commission_tiers
  WHERE is_active
    AND p_food_total >= min_amount
    AND (max_amount IS NULL OR p_food_total < max_amount)
  ORDER BY min_amount DESC
  LIMIT 1;
  IF v_tier_pct IS NOT NULL THEN RETURN v_tier_pct; END IF;

  SELECT default_commission_pct INTO v_default FROM platform_settings WHERE id = 1;
  RETURN COALESCE(v_default, 15);
END;
$$;

-- ---------------------------------------------------------------------
-- Rewrite settle_order_money_bags
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_order_money_bags()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_food_total numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_min_pay numeric;
  v_settings platform_settings%ROWTYPE;
  v_commission_pct numeric;
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_is_external boolean;
  v_store_charge numeric;
  v_base numeric;
  v_label text;
  v_cash_owed numeric;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM store_wallet_ledger
    WHERE order_id = NEW.id AND type IN ('order_earning','external_charge')
  ) THEN
    RETURN NEW;
  END IF;

  v_food_total   := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip          := COALESCE(NEW.tip_amount, 0);
  v_store_charge := COALESCE(NEW.store_charge, 0);
  v_is_cash      := (NEW.payment_method = 'cash');
  v_is_external  := (COALESCE(NEW.source, 'in_app') <> 'in_app');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay := COALESCE(v_settings.min_pay, 3);

  v_base := CASE WHEN v_is_external THEN v_store_charge ELSE v_food_total END;
  v_commission_pct := resolve_commission_pct(NEW.store_id, v_base);

  -- ADMIN = 5% of delivery_fee (guaranteed per-order profit)
  v_admin_cut := ROUND(v_delivery_fee * 0.05, 2);

  -- Store commission on food → platform pool
  v_total_commission := ROUND(v_base * (v_commission_pct / 100.0), 2);
  v_platform_cut     := v_total_commission;
  v_store_share      := v_base - v_total_commission;

  -- DRIVER PAY MODEL: customer's delivery_fee + tips, with min-pay guarantee
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target        := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  v_label := CASE WHEN v_is_external THEN UPPER(NEW.source) ELSE 'in-app' END;

  -- STORE WALLET
  IF v_is_external THEN
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, -v_store_charge, 0)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance - v_store_charge,
          updated_at = now();
    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'external_charge', -v_store_charge,
            v_label || ' delivery fee (' || COALESCE(NEW.external_ref, NEW.id::text) || ')');
  ELSE
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, v_store_share, v_store_share)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance + v_store_share,
          lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
          updated_at = now();
    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
            'Order ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' (' || (100 - v_commission_pct) || '% of ' || v_food_total || ')');
  END IF;

  -- ADMIN TREASURY
  UPDATE admin_treasury
    SET admin_balance            = admin_balance + v_admin_cut,
        platform_pool            = platform_pool + v_platform_cut,
        lifetime_admin_earned    = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup    = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut,
          '5% of delivery fee (' || v_delivery_fee || '€) [' || v_label || ']');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          'Commission ' || v_commission_pct || '% [' || v_label || ']'
          || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup,
            'Driver fair-pay top-up [' || v_label || ']');
  END IF;

  -- DRIVER WALLET (always credit fair pay; cash collected separately tracked)
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance)
    VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay [' || v_label || '] (fee ' || v_delivery_fee || '€ + tip ' || v_tip || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- CASH: driver collected, owes admin
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    IF v_is_external THEN
      v_cash_owed := v_food_total;
    ELSE
      v_cash_owed := v_food_total + v_delivery_fee;
    END IF;

    IF v_cash_owed > 0 THEN
      INSERT INTO driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share, amount_owed
      ) VALUES (
        NEW.driver_id, NEW.id, v_cash_owed,
        0,
        CASE WHEN v_is_external THEN 0 ELSE v_store_share END,
        v_admin_cut,
        GREATEST(v_platform_cut, 0),
        v_cash_owed
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Source: 20260429001132_157cd18d-563d-4b39-94b3-2c51093e6c23.sql

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_cash_cap numeric NOT NULL DEFAULT 200;

INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-proofs', 'delivery-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Drivers upload to their own folder: {driver_id}/{order_id}.jpg
DO $$ BEGIN
CREATE POLICY "Drivers upload own delivery proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "Drivers view own delivery proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "Store owners view their order proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE s.owner_id = auth.uid()
        AND o.photo_verification_url LIKE '%' || name
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "Support and admin view all delivery proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND public.is_support_or_admin(auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Source: 20260429004323_3b7f17f2-450c-44a5-a45b-d982930d83e9.sql
-- ─────────────────────────────────────────────────────────────
-- admin_reset_money_to_zero(): clear all balances, keep lifetime + history
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_money_to_zero()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_admin_bal numeric;
  v_platform_bal numeric;
  v_store_total numeric;
  v_driver_avail numeric;
  v_driver_pending numeric;
  v_driver_cash numeric;
  v_unsettled_debts numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset money';
  END IF;

  SELECT COALESCE(admin_balance, 0), COALESCE(platform_pool, 0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(balance), 0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance), 0), COALESCE(SUM(pending_balance), 0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance), 0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed), 0) INTO v_unsettled_debts
    FROM driver_cash_debts WHERE settled = false;

  v_snapshot := jsonb_build_object(
    'reset_at', now(),
    'reset_by', auth.uid(),
    'admin_balance_before', v_admin_bal,
    'platform_pool_before', v_platform_bal,
    'store_wallets_total_before', v_store_total,
    'driver_available_total_before', v_driver_avail,
    'driver_pending_total_before', v_driver_pending,
    'driver_shift_cash_total_before', v_driver_cash,
    'unsettled_cash_debts_before', v_unsettled_debts
  );

  -- Zero out balances (lifetime totals preserved)
  UPDATE admin_treasury SET admin_balance = 0, platform_pool = 0, updated_at = now() WHERE id = 1;
  UPDATE store_wallets SET balance = 0, updated_at = now();
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0, updated_at = now();
  UPDATE driver_state SET shift_cash_balance = 0, updated_at = now();
  UPDATE driver_cash_debts SET settled = true, settled_at = now(), settled_by = auth.uid()
    WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system', 'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_money_to_zero() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_money_to_zero() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- admin_wipe_transactions(): nuke all transactional data
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_wipe_transactions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_orders int; v_order_items int; v_earnings int;
  v_admin_ledger int; v_store_ledger int; v_customer_ledger int;
  v_monthly int; v_debts int; v_offers int;
  v_fraud int; v_tickets int; v_driver_notifs int; v_customer_notifs int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can wipe transactions';
  END IF;

  SELECT COUNT(*) INTO v_orders FROM orders;
  SELECT COUNT(*) INTO v_order_items FROM order_items;
  SELECT COUNT(*) INTO v_earnings FROM earnings;
  SELECT COUNT(*) INTO v_admin_ledger FROM admin_treasury_ledger;
  SELECT COUNT(*) INTO v_store_ledger FROM store_wallet_ledger;
  SELECT COUNT(*) INTO v_customer_ledger FROM customer_wallet_ledger;
  SELECT COUNT(*) INTO v_monthly FROM monthly_reports;
  SELECT COUNT(*) INTO v_debts FROM driver_cash_debts;
  SELECT COUNT(*) INTO v_offers FROM driver_offer_events;
  SELECT COUNT(*) INTO v_fraud FROM fraud_signals;
  SELECT COUNT(*) INTO v_tickets FROM support_tickets;
  SELECT COUNT(*) INTO v_driver_notifs FROM driver_notifications;
  SELECT COUNT(*) INTO v_customer_notifs FROM customer_notifications;

  v_snapshot := jsonb_build_object(
    'wiped_at', now(),
    'wiped_by', auth.uid(),
    'orders_deleted', v_orders,
    'order_items_deleted', v_order_items,
    'earnings_deleted', v_earnings,
    'admin_ledger_deleted', v_admin_ledger,
    'store_ledger_deleted', v_store_ledger,
    'customer_ledger_deleted', v_customer_ledger,
    'monthly_reports_deleted', v_monthly,
    'cash_debts_deleted', v_debts,
    'offer_events_deleted', v_offers,
    'fraud_signals_deleted', v_fraud,
    'support_tickets_deleted', v_tickets,
    'driver_notifications_deleted', v_driver_notifs,
    'customer_notifications_deleted', v_customer_notifs
  );

  -- Children first
  DELETE FROM order_item_modifiers WHERE order_item_id IN (SELECT id FROM order_items);
  DELETE FROM order_items;
  DELETE FROM earnings;
  DELETE FROM driver_cash_debts;
  DELETE FROM driver_offer_events;
  DELETE FROM admin_treasury_ledger;
  DELETE FROM store_wallet_ledger;
  DELETE FROM customer_wallet_ledger;
  DELETE FROM monthly_reports;
  DELETE FROM fraud_signals;
  DELETE FROM support_ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets);
  DELETE FROM support_tickets;
  DELETE FROM driver_notifications;
  DELETE FROM customer_notifications;
  DELETE FROM orders;

  -- Reset every balance to absolute zero (incl. lifetime)
  UPDATE admin_treasury SET admin_balance = 0, platform_pool = 0,
    lifetime_admin_earned = 0, lifetime_platform_earned = 0, lifetime_driver_topup = 0,
    updated_at = now() WHERE id = 1;
  UPDATE store_wallets SET balance = 0, lifetime_earned = 0, lifetime_paid_out = 0, updated_at = now();
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0, total_withdrawn = 0, updated_at = now();
  UPDATE driver_state SET shift_cash_balance = 0, shift_started_at = NULL, on_break = false, break_until = NULL, updated_at = now();
  UPDATE customer_wallets SET balance = 0, lifetime_credit = 0, updated_at = now();

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'wipe_transactions', 'system', 'All transactional data wiped', v_snapshot);

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_wipe_transactions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_wipe_transactions() TO authenticated;

-- Source: 20260429005611_2df844f2-b575-418f-826d-0e3319899626.sql
-- Drop the duplicate trigger on earnings; keep trg_credit_wallet_on_earning
DROP TRIGGER IF EXISTS credit_wallet_after_earning ON public.earnings;
-- SKIPPED: deletion of specific test order (not present in fresh DB)

-- Source: 20260429005926_65c9a882-6279-4e94-91d4-5fd625bf2359.sql

-- 1) Add a 'reversed' status marker support (text column, no schema change needed)
-- 2) Mark orphan earning_credit rows (no order_id) as reversed
UPDATE public.wallet_transactions
SET status = 'reversed',
    description = COALESCE(description, '') || ' [auto-reversed: orphan duplicate from trigger bug]'
WHERE type = 'earning_credit'
  AND status = 'completed'
  AND order_id IS NULL;

-- 3) For each (driver_id, order_id) keep the OLDEST earning_credit, reverse the rest
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY driver_id, order_id ORDER BY created_at ASC) AS rn
  FROM public.wallet_transactions
  WHERE type = 'earning_credit'
    AND status = 'completed'
    AND order_id IS NOT NULL
)
UPDATE public.wallet_transactions wt
SET status = 'reversed',
    description = COALESCE(wt.description, '') || ' [auto-reversed: duplicate from trigger bug]'
FROM ranked
WHERE wt.id = ranked.id AND ranked.rn > 1;

-- 4) Recompute driver_wallets.available_balance from truth
--    real_credits = sum of remaining 'completed' earning_credit + support_credit + manual_credit etc.
--    withdrawn   = wallet.total_withdrawn (already correct, equals completed withdrawal_request)
WITH real_credits AS (
  SELECT driver_id, COALESCE(SUM(amount), 0) AS credited
  FROM public.wallet_transactions
  WHERE status = 'completed'
    AND type IN ('earning_credit','support_credit','manual_credit','bonus','referral_bonus','topup')
  GROUP BY driver_id
),
recomputed AS (
  SELECT dw.driver_id,
         COALESCE(rc.credited, 0) - dw.total_withdrawn AS new_balance,
         dw.available_balance AS old_balance,
         COALESCE(rc.credited, 0) AS credited
  FROM public.driver_wallets dw
  LEFT JOIN real_credits rc ON rc.driver_id = dw.driver_id
)
UPDATE public.driver_wallets dw
SET available_balance = GREATEST(r.new_balance, 0),
    updated_at = now()
FROM recomputed r
WHERE dw.driver_id = r.driver_id;

-- 5) Log overpayments (where reconciled balance went negative) into admin_audit_log
INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, description, metadata)
SELECT
  dw.driver_id,
  'system',
  'wallet_reconciliation',
  'driver_wallet',
  dw.driver_id::text,
  'Driver overpaid due to duplicate-trigger bug. Balance clamped to 0.',
  jsonb_build_object(
    'old_balance', r.old_balance,
    'real_credits', r.credited,
    'total_withdrawn', dw.total_withdrawn,
    'computed_balance', r.new_balance,
    'overpayment', ABS(r.new_balance)
  )
FROM public.driver_wallets dw
JOIN (
  WITH real_credits AS (
    SELECT driver_id, COALESCE(SUM(amount), 0) AS credited
    FROM public.wallet_transactions
    WHERE status = 'completed'
      AND type IN ('earning_credit','support_credit','manual_credit','bonus','referral_bonus','topup')
    GROUP BY driver_id
  )
  SELECT dw2.driver_id,
         COALESCE(rc.credited, 0) - dw2.total_withdrawn AS new_balance,
         COALESCE(rc.credited, 0) AS credited,
         (COALESCE(rc.credited, 0) - dw2.total_withdrawn) AS old_balance
  FROM public.driver_wallets dw2
  LEFT JOIN real_credits rc ON rc.driver_id = dw2.driver_id
) r ON r.driver_id = dw.driver_id
WHERE r.new_balance < 0;


-- Source: 20260429010302_7effa406-0fcb-46da-9eca-49ef4423f293.sql

CREATE OR REPLACE FUNCTION public.admin_wipe_transactions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_orders int; v_order_items int; v_earnings int;
  v_admin_ledger int; v_store_ledger int; v_customer_ledger int;
  v_monthly int; v_debts int; v_offers int;
  v_fraud int; v_tickets int; v_driver_notifs int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can wipe transactions';
  END IF;

  SELECT COUNT(*) INTO v_orders FROM orders;
  SELECT COUNT(*) INTO v_order_items FROM order_items;
  SELECT COUNT(*) INTO v_earnings FROM earnings;
  SELECT COUNT(*) INTO v_admin_ledger FROM admin_treasury_ledger;
  SELECT COUNT(*) INTO v_store_ledger FROM store_wallet_ledger;
  SELECT COUNT(*) INTO v_customer_ledger FROM customer_wallet_ledger;
  SELECT COUNT(*) INTO v_monthly FROM monthly_reports;
  SELECT COUNT(*) INTO v_debts FROM driver_cash_debts;
  SELECT COUNT(*) INTO v_offers FROM driver_offer_events;
  SELECT COUNT(*) INTO v_fraud FROM fraud_signals;
  SELECT COUNT(*) INTO v_tickets FROM support_tickets;
  SELECT COUNT(*) INTO v_driver_notifs FROM driver_notifications;

  v_snapshot := jsonb_build_object(
    'wiped_at', now(),
    'wiped_by', auth.uid(),
    'orders_deleted', v_orders,
    'order_items_deleted', v_order_items,
    'earnings_deleted', v_earnings,
    'admin_ledger_deleted', v_admin_ledger,
    'store_ledger_deleted', v_store_ledger,
    'customer_ledger_deleted', v_customer_ledger,
    'monthly_reports_deleted', v_monthly,
    'cash_debts_deleted', v_debts,
    'offer_events_deleted', v_offers,
    'fraud_signals_deleted', v_fraud,
    'support_tickets_deleted', v_tickets,
    'driver_notifications_deleted', v_driver_notifs
  );

  -- Children first
  DELETE FROM order_item_modifiers WHERE order_item_id IN (SELECT id FROM order_items);
  DELETE FROM order_items;
  DELETE FROM earnings;
  DELETE FROM driver_cash_debts;
  DELETE FROM driver_offer_events;
  DELETE FROM admin_treasury_ledger;
  DELETE FROM store_wallet_ledger;
  DELETE FROM customer_wallet_ledger;
  DELETE FROM monthly_reports;
  DELETE FROM fraud_signals;
  DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets);
  DELETE FROM support_tickets;
  DELETE FROM driver_notifications;
  DELETE FROM wallet_transactions;
  DELETE FROM orders;

  -- Reset every balance to absolute zero (incl. lifetime)
  UPDATE admin_treasury SET admin_balance = 0, platform_pool = 0,
    lifetime_admin_earned = 0, lifetime_platform_earned = 0, lifetime_driver_topup = 0,
    updated_at = now() WHERE id = 1;
  UPDATE store_wallets SET available_balance = 0, pending_balance = 0,
    lifetime_earnings = 0, updated_at = now();
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0,
    total_withdrawn = 0, updated_at = now();
  UPDATE driver_state SET shift_cash_balance = 0, updated_at = now();
  UPDATE customer_wallets SET balance = 0, lifetime_credit = 0, updated_at = now();
  UPDATE customer_rewards SET points = 0, lifetime_points = 0, tier = 'bronze', updated_at = now();

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'wipe_transactions', 'system',
          'Wiped all transactional data and reset balances to zero', v_snapshot);

  RETURN v_snapshot;
END;
$function$;


-- Source: 20260429012230_9250c321-31f2-45bc-ac37-c9127e0cdf55.sql
-- Guard absurd overrides on external order creation (defense-in-depth)
CREATE OR REPLACE FUNCTION public.create_external_order(p_store_id uuid, p_source text, p_total_amount numeric, p_delivery_address text, p_delivery_lat double precision DEFAULT NULL::double precision, p_delivery_lng double precision DEFAULT NULL::double precision, p_distance_km numeric DEFAULT NULL::numeric, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_external_ref text DEFAULT NULL::text, p_driver_payout_override numeric DEFAULT NULL::numeric, p_store_charge_override numeric DEFAULT NULL::numeric, p_items_summary text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  v_is_priv  := is_support_or_admin(auth.uid());
  v_is_owner := (v_store.owner_id = auth.uid());

  IF NOT (v_is_priv OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to create orders for this store';
  END IF;

  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  IF NOT v_is_priv AND (p_driver_payout_override IS NOT NULL OR p_store_charge_override IS NOT NULL) THEN
    RAISE EXCEPTION 'Only admin/support can override pricing';
  END IF;

  -- Sanity guards: prevent absurd values that break the books
  IF p_driver_payout_override IS NOT NULL AND (p_driver_payout_override < 0 OR p_driver_payout_override > 50) THEN
    RAISE EXCEPTION 'Driver payout override must be between 0 and 50€ (got %)', p_driver_payout_override;
  END IF;
  IF p_store_charge_override IS NOT NULL AND (p_store_charge_override < 0 OR p_store_charge_override > 1000) THEN
    RAISE EXCEPTION 'Store charge override must be between 0 and 1000€ (got %)', p_store_charge_override;
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSE
    CASE v_store.ext_billing_mode
      WHEN 'commission'         THEN v_store_charge := ROUND((p_total_amount * v_store.ext_commission_pct / 100)::numeric, 2);
      WHEN 'flat_fee'           THEN v_store_charge := v_store.ext_flat_fee;
      WHEN 'driver_plus_margin' THEN v_store_charge := ROUND((v_driver_pay * (1 + v_store.ext_margin_pct / 100))::numeric, 2);
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END
  );

  INSERT INTO orders (
    store_id, status, source, external_ref,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout, platform_profit
  ) VALUES (
    p_store_id, 'placed', p_source, p_external_ref,
    p_total_amount, v_driver_pay, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, 'external',
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- Source: 20260429012324_d967df3e-d3f5-4036-b038-e530da493f79.sql
-- SKIPPED: data-fixing statements referencing specific order IDs from original DB (not present in fresh DB)

-- Source: 20260429012536_0bfedaa4-4a0e-49ea-86a8-908ad716ce79.sql
-- 1) Promotion columns on stores
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS promotion_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_approved_by uuid;

-- Validate status values via trigger (no CHECK constraint per project rules)
CREATE OR REPLACE FUNCTION public.validate_store_promotion_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.promotion_status NOT IN ('none','requested','active','rejected','expired') THEN
    RAISE EXCEPTION 'Invalid promotion_status: %', NEW.promotion_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_store_promotion_status_trg ON public.stores;
CREATE TRIGGER validate_store_promotion_status_trg
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.validate_store_promotion_status();

-- Protect promotion fields: only admins or the owner (via the RPC) may modify them
CREATE OR REPLACE FUNCTION public.protect_store_promotion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (OLD.promotion_status IS DISTINCT FROM NEW.promotion_status
      OR OLD.promotion_starts_at IS DISTINCT FROM NEW.promotion_starts_at
      OR OLD.promotion_ends_at IS DISTINCT FROM NEW.promotion_ends_at
      OR OLD.promotion_amount_paid IS DISTINCT FROM NEW.promotion_amount_paid
      OR OLD.promotion_approved_by IS DISTINCT FROM NEW.promotion_approved_by
      OR OLD.promotion_requested_at IS DISTINCT FROM NEW.promotion_requested_at)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can modify promotion fields directly. Use the dedicated functions.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_store_promotion_trg ON public.stores;
CREATE TRIGGER protect_store_promotion_trg
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.protect_store_promotion();

-- 2) Store owner: request a promotion
CREATE OR REPLACE FUNCTION public.request_store_promotion(p_store_id uuid, p_days integer, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
    RAISE EXCEPTION 'Days must be between 1 and 90';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 1000 THEN
    RAISE EXCEPTION 'Amount must be between 0 and 1000';
  END IF;

  SELECT owner_id INTO v_owner FROM stores WHERE id = p_store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_owner <> auth.uid() AND NOT is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE stores SET
    promotion_status = 'requested',
    promotion_requested_at = now(),
    promotion_amount_paid = p_amount,
    promotion_starts_at = now(),
    promotion_ends_at = now() + (p_days || ' days')::interval,
    promotion_approved_by = NULL
  WHERE id = p_store_id;
END;
$$;

-- 3) Admin: approve / reject / cancel
CREATE OR REPLACE FUNCTION public.admin_set_store_promotion(
  p_store_id uuid, p_status text, p_days integer DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can manage promotions';
  END IF;
  IF p_status NOT IN ('active','rejected','none','expired') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  IF p_status = 'active' THEN
    UPDATE stores SET
      promotion_status = 'active',
      promotion_starts_at = COALESCE(promotion_starts_at, now()),
      promotion_ends_at = CASE
        WHEN p_days IS NOT NULL THEN now() + (p_days || ' days')::interval
        ELSE COALESCE(promotion_ends_at, now() + interval '7 days')
      END,
      promotion_approved_by = auth.uid()
    WHERE id = p_store_id;
  ELSE
    UPDATE stores SET
      promotion_status = p_status,
      promotion_approved_by = auth.uid()
    WHERE id = p_store_id;
  END IF;

  PERFORM log_admin_action(
    'set_store_promotion', 'store', p_store_id::text,
    'Promotion → ' || p_status,
    jsonb_build_object('status', p_status, 'days', p_days)
  );
END;
$$;

-- Source: 20260429012834_afc37f28-0a21-4f5b-be96-a290c08bb67e.sql
ALTER TABLE public.stores DISABLE TRIGGER USER;

UPDATE public.stores SET is_active = false 
WHERE id NOT IN (SELECT id FROM public.stores ORDER BY created_at ASC, name ASC LIMIT 10);

ALTER TABLE public.stores ENABLE TRIGGER USER;

-- Source: 20260429020405_7893e3b6-a6a2-44f7-8def-ac16d59cddb8.sql
-- Pending offers table
CREATE TABLE IF NOT EXISTS public.pending_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  wave INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | expired | cancelled
  distance_km NUMERIC,
  score NUMERIC,
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, driver_id, wave)
);

CREATE INDEX IF NOT EXISTS idx_pending_offers_driver_status ON public.pending_offers(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_offers_order_status ON public.pending_offers(order_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_offers_expires ON public.pending_offers(expires_at) WHERE status = 'pending';

ALTER TABLE public.pending_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers view own pending offers" ON public.pending_offers;
CREATE POLICY "Drivers view own pending offers"
ON public.pending_offers FOR SELECT
USING (auth.uid() = driver_id);

DROP POLICY IF EXISTS "Drivers update own pending offers" ON public.pending_offers;
CREATE POLICY "Drivers update own pending offers"
ON public.pending_offers FOR UPDATE
USING (auth.uid() = driver_id)
WITH CHECK (auth.uid() = driver_id);

DROP POLICY IF EXISTS "Support and admins view all offers" ON public.pending_offers;
CREATE POLICY "Support and admins view all offers"
ON public.pending_offers FOR SELECT
USING (is_support_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage all offers" ON public.pending_offers;
CREATE POLICY "Admins manage all offers"
ON public.pending_offers FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Realtime so the driver app gets new offers instantly
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_offers;; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: rank nearby active drivers for a given pickup point
-- Returns drivers sorted by a composite score (lower = better)
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  _store_lat DOUBLE PRECISION,
  _store_lng DOUBLE PRECISION,
  _order_value NUMERIC DEFAULT 0,
  _exclude_drivers UUID[] DEFAULT ARRAY[]::UUID[],
  _limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  driver_id UUID,
  distance_km NUMERIC,
  vehicle_type TEXT,
  score NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;

  RETURN QUERY
  WITH driver_pool AS (
    SELECT
      dp.user_id AS drv_id,
      COALESCE(dp.vehicle_type, 'motorcycle') AS v_type,
      dl.latitude AS lat,
      dl.longitude AS lng,
      -- Simple haversine in km
      (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_store_lat)) * cos(radians(dl.latitude)) *
          cos(radians(dl.longitude) - radians(_store_lng)) +
          sin(radians(_store_lat)) * sin(radians(dl.latitude))
        ))
      ))::NUMERIC AS dist_km,
      COALESCE(ds.on_break, false) AS on_brk
    FROM driver_profiles dp
    JOIN driver_locations dl ON dl.driver_id = dp.user_id
    LEFT JOIN driver_state ds ON ds.driver_id = dp.user_id
    WHERE dp.is_active = true
      AND dp.suspended_at IS NULL
      AND dl.updated_at > now() - INTERVAL '5 minutes'
      AND NOT (dp.user_id = ANY(_exclude_drivers))
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.driver_id = dp.user_id
          AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pending_offers po
        WHERE po.driver_id = dp.user_id AND po.status = 'pending'
      )
  )
  SELECT
    dp.drv_id,
    ROUND(dp.dist_km, 2),
    dp.v_type,
    -- Composite score: distance weight only for now (rating/acceptance can be layered later)
    ROUND(dp.dist_km * COALESCE(s.dist_distance_weight, 0.3) * 10, 3) AS score
  FROM driver_pool dp
  WHERE dp.on_brk = false
    AND dp.dist_km <= COALESCE(s.dist_search_radius_km, 5)
    AND (
      NOT COALESCE(s.dist_vehicle_rules_enabled, false)
      OR (
        (dp.v_type = 'bike' AND dp.dist_km <= COALESCE(s.dist_bike_max_km, 3))
        OR (dp.v_type = 'motorcycle' AND dp.dist_km <= COALESCE(s.dist_motorcycle_max_km, 8))
        OR (dp.v_type = 'car' AND _order_value >= COALESCE(s.dist_car_min_value, 25))
        OR dp.v_type NOT IN ('bike','motorcycle','car')
      )
    )
  ORDER BY score ASC, dp.dist_km ASC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nearby_active_drivers TO authenticated, service_role;

-- Source: 20260429020415_54fa852d-4d76-48c9-9d77-9f228d4df59c.sql
REVOKE EXECUTE ON FUNCTION public.nearby_active_drivers FROM PUBLIC, anon;

-- Source: 20260429193003_415dffa4-998d-46e1-a2f8-17dbd7b58b3f.sql
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS platform_service_fee numeric NOT NULL DEFAULT 0.99;

-- Source: 20260429224619_2c968f09-e504-4248-bcdf-3c493018c0e4.sql
ALTER TABLE public.stores REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.stores;; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Source: 20260429230257_d34d2509-78bd-4bae-8a8f-31fc25acc95d.sql
-- Add payment_method support to external order creation.
-- 'cash'     => driver collects cash from customer; existing completion trigger
--               creates a driver_cash_debts row so the driver owes admin for our
--               share. Once the driver deposits the money, admin settles it.
-- 'card'     => store already received card payment via the external platform
--               (eFood/Wolt/Box). No cash collection; store_charge is added to
--               what the store owes us via normal billing.
-- 'external' => legacy default kept for backwards compatibility (treated like card).
CREATE OR REPLACE FUNCTION public.create_external_order(
  p_store_id uuid,
  p_source text,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL::double precision,
  p_delivery_lng double precision DEFAULT NULL::double precision,
  p_distance_km numeric DEFAULT NULL::numeric,
  p_customer_name text DEFAULT NULL::text,
  p_customer_phone text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_external_ref text DEFAULT NULL::text,
  p_driver_payout_override numeric DEFAULT NULL::numeric,
  p_store_charge_override numeric DEFAULT NULL::numeric,
  p_items_summary text DEFAULT NULL::text,
  p_payment_method text DEFAULT 'external'::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
  v_pm text;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  v_is_priv  := is_support_or_admin(auth.uid());
  v_is_owner := (v_store.owner_id = auth.uid());

  IF NOT (v_is_priv OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to create orders for this store';
  END IF;

  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  IF NOT v_is_priv AND (p_driver_payout_override IS NOT NULL OR p_store_charge_override IS NOT NULL) THEN
    RAISE EXCEPTION 'Only admin/support can override pricing';
  END IF;

  IF p_driver_payout_override IS NOT NULL AND (p_driver_payout_override < 0 OR p_driver_payout_override > 50) THEN
    RAISE EXCEPTION 'Driver payout override must be between 0 and 50€ (got %)', p_driver_payout_override;
  END IF;
  IF p_store_charge_override IS NOT NULL AND (p_store_charge_override < 0 OR p_store_charge_override > 1000) THEN
    RAISE EXCEPTION 'Store charge override must be between 0 and 1000€ (got %)', p_store_charge_override;
  END IF;

  v_pm := COALESCE(NULLIF(p_payment_method, ''), 'external');
  IF v_pm NOT IN ('cash','card','external') THEN
    RAISE EXCEPTION 'Invalid payment_method (got %)', v_pm;
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSE
    CASE v_store.ext_billing_mode
      WHEN 'commission'         THEN v_store_charge := ROUND((p_total_amount * v_store.ext_commission_pct / 100)::numeric, 2);
      WHEN 'flat_fee'           THEN v_store_charge := v_store.ext_flat_fee;
      WHEN 'driver_plus_margin' THEN v_store_charge := ROUND((v_driver_pay * (1 + v_store.ext_margin_pct / 100))::numeric, 2);
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END,
    CASE WHEN v_pm = 'cash' THEN '💶 ΜΕΤΡΗΤΑ — εισπράττει ο οδηγός' END
  );

  INSERT INTO orders (
    store_id, status, source, external_ref,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout, platform_profit
  ) VALUES (
    p_store_id, 'placed', p_source, p_external_ref,
    p_total_amount, v_driver_pay, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, v_pm,
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' (' || v_pm || ') for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'payment_method', v_pm,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- Source: 20260429234041_38fc2c76-a638-40ef-99f1-ee522a4ab496.sql

-- 1) store_pricing_overrides: restrict SELECT to admins + the relevant store owner
DROP POLICY IF EXISTS "Anyone authenticated can view overrides" ON public.store_pricing_overrides;

CREATE POLICY "Admins and store owners can view overrides"
ON public.store_pricing_overrides
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = store_pricing_overrides.store_id
      AND s.owner_id = auth.uid()
  )
);

-- 2) user_roles: explicit RESTRICTIVE policies blocking non-admin INSERT/UPDATE/DELETE
-- (Defence in depth on top of the existing PERMISSIVE "Admins can manage roles" policy.)
CREATE POLICY "Block non-admin role inserts"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block non-admin role updates"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block non-admin role deletes"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) order_item_modifiers: restrict to order participants
DROP POLICY IF EXISTS "Authed users view order item modifiers" ON public.order_item_modifiers;
DROP POLICY IF EXISTS "Authed users insert order item modifiers" ON public.order_item_modifiers;

CREATE POLICY "Order participants can view item modifiers"
ON public.order_item_modifiers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN public.stores s ON s.id = o.store_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
        OR public.is_support_or_admin(auth.uid())
      )
  )
);

CREATE POLICY "Order customer can insert item modifiers"
ON public.order_item_modifiers
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        o.customer_id = auth.uid()
        OR public.is_support_or_admin(auth.uid())
      )
  )
);


