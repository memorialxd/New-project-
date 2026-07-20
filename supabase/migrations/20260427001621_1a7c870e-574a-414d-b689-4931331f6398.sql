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