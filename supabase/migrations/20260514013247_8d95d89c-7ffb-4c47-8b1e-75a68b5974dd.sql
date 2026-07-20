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
  store_extra numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  pool_take numeric;
  is_cash boolean;
  total_credit numeric := 0;
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

      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();

      -- Record transaction for driver visibility
      INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
      VALUES (NEW.driver_id, 'earning_credit', bonus_amt, 'completed',
              'Πληρωμή παράδοσης (driver pool)', NEW.id);
      total_credit := total_credit + bonus_amt;
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND NOT is_cash THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();

    INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', delivery_amt, 'completed',
            'Delivery fee', NEW.id);
    total_credit := total_credit + delivery_amt;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.driver_payout := COALESCE(bonus_amt, 0) + CASE WHEN NOT is_cash THEN COALESCE(delivery_amt, 0) ELSE 0 END;
  NEW.store_charge := COALESCE((split->>'store_commission')::numeric, 0);

  RETURN NEW;
END $function$;