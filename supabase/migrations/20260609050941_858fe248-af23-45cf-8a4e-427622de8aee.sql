CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric := 0;
  pool_amt numeric := 0;
  delivery_amt numeric := 0;
  tip_amt numeric := 0;
  store_extra numeric := 0;
  store_keeps_amt numeric := 0;
  pool_balance numeric := 0;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean := false;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  driver_base_pay numeric := 0;
  locked_payout numeric := 0;
  s_pause boolean := false;
  s_subsidize boolean := false;
  s_low numeric := 0;
  s_alert boolean := true;
  pay_paused boolean := false;
  shortfall numeric := 0;
  queued_amount numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

  SELECT pause_bonus_when_critical, subsidize_min_pay, low_pool_threshold, pool_alert_enabled
    INTO s_pause, s_subsidize, s_low, s_alert
    FROM public.platform_settings WHERE id = 1;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

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
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    shortfall := GREATEST(driver_base_pay - pool_balance, 0);

    pay_paused := (COALESCE(s_pause, false)
                   AND NOT COALESCE(s_subsidize, false)
                   AND shortfall > 0
                   AND pool_balance < COALESCE(s_low, 0));

    IF pay_paused THEN
      INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
      VALUES (NEW.driver_id, NEW.id, driver_base_pay + tip_amt, 'pool_insufficient')
      ON CONFLICT (order_id, driver_id) DO NOTHING;

      IF COALESCE(s_alert, true) THEN
        INSERT INTO public.announcements (title, message, target_audience, expires_at)
        VALUES (
          'Driver Buffer χαμηλό',
          'Παραγγελία ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' δεν πληρώθηκε σε driver (απαιτείται €' || ROUND(driver_base_pay,2)
            || ', διαθέσιμο €' || ROUND(pool_balance,2) || '). Top-up το Driver Buffer.',
          'admin',
          now() + interval '24 hours'
        );
      END IF;

      pool_take := 0;
      admin_subsidy := 0;
      driver_share_total := 0;

      -- Still record the trip in earnings so it counts in stats/history.
      -- Wallet credit will happen when admin releases the pending payout.
      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );
    ELSE
      pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
      admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

      IF admin_subsidy > 0 AND NOT COALESCE(s_subsidize, false) THEN
        queued_amount := admin_subsidy;
        INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
        VALUES (NEW.driver_id, NEW.id, queued_amount, 'pool_insufficient')
        ON CONFLICT (order_id, driver_id) DO NOTHING;

        IF COALESCE(s_alert, true) THEN
          INSERT INTO public.announcements (title, message, target_audience, expires_at)
          VALUES (
            'Driver Buffer χαμηλό',
            'Λείπουν €' || ROUND(queued_amount,2) || ' από driver payout (order '
              || COALESCE(NEW.external_ref, NEW.id::text) || '). Top-up το Driver Buffer.',
            'admin',
            now() + interval '24 hours'
          );
        END IF;
        admin_subsidy := 0;
        driver_base_pay := pool_take;
      END IF;

      driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

      IF pool_take > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
        UPDATE public.admin_treasury
          SET platform_pool = GREATEST(platform_pool - pool_take, 0),
              lifetime_driver_topup = lifetime_driver_topup + pool_take,
              updated_at = now()
          WHERE id = 1;
      END IF;

      IF admin_subsidy > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - admin_subsidy,
              updated_at = now()
          WHERE id = 1;
      END IF;

      -- Always record trip in earnings (driver_base_pay reflects what they actually got from buffer/admin now)
      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );

      IF driver_share_total > 0 THEN
        INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
        VALUES (NEW.driver_id, driver_share_total, 0, 0)
        ON CONFLICT (driver_id) DO UPDATE
          SET available_balance = public.driver_wallets.available_balance + driver_share_total,
              updated_at = now();

        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        SELECT NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Κέρδος παράδοσης', NEW.id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.wallet_transactions wt
          WHERE wt.order_id = NEW.id
            AND wt.driver_id = NEW.driver_id
            AND wt.type = 'earning_credit'
        );
      END IF;
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, 0);
      IF cash_collected <= 0 THEN
        cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
      END IF;

      IF cash_collected > 0 THEN
        INSERT INTO public.driver_cash_debts (
          driver_id, order_id, cash_collected,
          driver_share, amount_owed, store_share, platform_share, admin_share, settled
        )
        SELECT NEW.driver_id, NEW.id, cash_collected,
               driver_share_total, cash_collected, store_keeps_amt, pool_amt + store_extra, admin_amt, false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.driver_cash_debts d WHERE d.order_id = NEW.id AND d.driver_id = NEW.driver_id
        );
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := driver_base_pay;
  RETURN NEW;
END;
$function$;

-- Backfill the recent delivered order whose earnings row was skipped
INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
SELECT o.driver_id, o.id,
       COALESCE(p.amount, 0) - COALESCE(o.tip_amount, 0),
       0,
       COALESCE(o.tip_amount, 0)
FROM public.orders o
JOIN public.pending_driver_payouts p ON p.order_id = o.id AND p.driver_id = o.driver_id AND p.resolved = false
WHERE o.status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM public.earnings e WHERE e.order_id = o.id AND e.driver_id = o.driver_id
  );