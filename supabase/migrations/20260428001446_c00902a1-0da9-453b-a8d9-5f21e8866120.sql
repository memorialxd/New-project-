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