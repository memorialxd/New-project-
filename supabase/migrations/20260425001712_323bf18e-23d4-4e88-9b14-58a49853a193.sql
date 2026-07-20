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
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_amount_owed numeric;
  v_is_external boolean;
  v_store_charge numeric;
  v_base numeric;
  v_label text;
BEGIN
  -- Only on transition to delivered
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Skip if already settled
  IF EXISTS (SELECT 1 FROM store_wallet_ledger WHERE order_id = NEW.id AND type IN ('order_earning','external_charge')) THEN
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

  -- ============================================================
  -- Choose the base amount the 85/5/10 split applies to:
  --   in-app   → total_amount (food)
  --   external → store_charge (what we bill the store)
  -- ============================================================
  v_base := CASE WHEN v_is_external THEN v_store_charge ELSE v_food_total END;

  v_total_commission := ROUND(v_base * 0.15, 2);
  v_admin_cut        := ROUND(v_base * 0.05, 2);
  v_platform_cut     := v_total_commission - v_admin_cut;
  v_store_share      := v_base - v_total_commission;

  -- Driver fairness: max(min_pay, delivery_fee + tip)
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  v_label := CASE WHEN v_is_external THEN UPPER(NEW.source) ELSE 'in-app' END;

  -- ============================================================
  -- STORE WALLET
  --   in-app   → CREDIT 85% of food_total (we owe store)
  --   external → DEBIT full store_charge (store owes platform for service)
  -- ============================================================
  IF v_is_external THEN
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, -v_store_charge, 0)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance - v_store_charge,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'external_charge', -v_store_charge,
            v_label || ' delivery fee charged to store ('
            || COALESCE(NEW.external_ref, NEW.id::text) || ')');
  ELSE
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, v_store_share, v_store_share)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance + v_store_share,
          lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
            'In-app order ' || COALESCE(NEW.external_ref, NEW.id::text) || ' (85% of ' || v_food_total || ')');
  END IF;

  -- ============================================================
  -- ADMIN TREASURY (same logic for both, base differs)
  -- ============================================================
  UPDATE admin_treasury
    SET admin_balance = admin_balance + v_admin_cut,
        platform_pool = platform_pool + v_platform_cut,
        lifetime_admin_earned = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut, '5% admin cut [' || v_label || ']');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          '10% platform pool [' || v_label || ']'
          || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ driver top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup,
            'Top-up to guarantee fair driver pay [' || v_label || ']');
  END IF;

  -- ============================================================
  -- DRIVER WALLET (always fair pay)
  -- ============================================================
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance) VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay [' || v_label || '] (delivery ' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- ============================================================
  -- CASH HANDLING
  --   in-app cash:   driver collected food + delivery, owes back (food + delivery − fair pay)
  --   external cash: driver collected food, owes back (food − fair pay) — store_charge stays as store debt
  -- ============================================================
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    IF v_is_external THEN
      v_amount_owed := v_food_total - v_driver_target;
    ELSE
      v_amount_owed := (v_food_total + v_delivery_fee) - v_driver_target;
    END IF;

    IF v_amount_owed > 0 THEN
      INSERT INTO driver_cash_debts (
        driver_id, order_id, cash_collected, driver_share,
        store_share, admin_share, platform_share, amount_owed
      ) VALUES (
        NEW.driver_id, NEW.id,
        CASE WHEN v_is_external THEN v_food_total ELSE v_food_total + v_delivery_fee END,
        v_driver_target,
        CASE WHEN v_is_external THEN 0 ELSE v_store_share END,
        v_admin_cut,
        GREATEST(v_platform_cut, 0),
        v_amount_owed
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;