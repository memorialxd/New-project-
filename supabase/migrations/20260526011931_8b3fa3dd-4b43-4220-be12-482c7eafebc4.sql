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