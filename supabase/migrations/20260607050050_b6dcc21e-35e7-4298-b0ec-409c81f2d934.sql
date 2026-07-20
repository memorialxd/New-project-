
-- 1) Add settings flag to allow pickup before ready
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS allow_pickup_before_ready boolean NOT NULL DEFAULT false;

-- 2) Create pending driver payouts table for when buffer is too low
CREATE TABLE IF NOT EXISTS public.pending_driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount numeric NOT NULL,
  reason text NOT NULL DEFAULT 'pool_insufficient',
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, driver_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_driver_payouts TO authenticated;
GRANT ALL ON public.pending_driver_payouts TO service_role;

ALTER TABLE public.pending_driver_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pending payouts" ON public.pending_driver_payouts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Drivers see their pending payouts" ON public.pending_driver_payouts
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- 3) Update settle_order_commission to honor pause_bonus_when_critical / subsidize_min_pay
CREATE OR REPLACE FUNCTION public.settle_order_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    shortfall := GREATEST(driver_base_pay - pool_balance, 0);

    -- NEW LOGIC: pause payout when pool is low AND admin opted into pause + no subsidy
    pay_paused := (COALESCE(s_pause, false)
                   AND NOT COALESCE(s_subsidize, false)
                   AND shortfall > 0
                   AND pool_balance < COALESCE(s_low, 0));

    IF pay_paused THEN
      -- queue the full pay as a pending payout; nothing leaves the buffer
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

      driver_share_total := 0;
      pool_take := 0;
      admin_subsidy := 0;
    ELSE
      pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
      admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

      -- Only subsidize from admin if admin opted in; otherwise pay only what pool has
      IF admin_subsidy > 0 AND NOT COALESCE(s_subsidize, false) THEN
        -- pay only what's in the pool, queue the rest
        IF admin_subsidy > 0 THEN
          INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
          VALUES (NEW.driver_id, NEW.id, admin_subsidy, 'pool_insufficient')
          ON CONFLICT (order_id, driver_id) DO NOTHING;

          IF COALESCE(s_alert, true) THEN
            INSERT INTO public.announcements (title, message, target_audience, expires_at)
            VALUES (
              'Driver Buffer χαμηλό',
              'Λείπουν €' || ROUND(admin_subsidy,2) || ' από driver payout (order '
                || COALESCE(NEW.external_ref, NEW.id::text) || '). Top-up το Driver Buffer.',
              'admin',
              now() + interval '24 hours'
            );
          END IF;
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

      IF driver_share_total > 0 THEN
        INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
        SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
        WHERE NOT EXISTS (
          SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
        );

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

-- 4) Update guard_picked_up_requires_ready to honor allow_pickup_before_ready setting
CREATE OR REPLACE FUNCTION public.guard_picked_up_requires_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allow boolean := false;
BEGIN
  IF NEW.status::text = 'picked_up'
     AND OLD.status::text NOT IN ('ready', 'arrived', 'picked_up') THEN
    SELECT COALESCE(allow_pickup_before_ready, false)
      INTO v_allow FROM public.platform_settings WHERE id = 1;
    IF NOT v_allow THEN
      RAISE EXCEPTION 'Order must be marked ready by the store before pickup'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5) RPC: admin resolves a pending payout (credits driver wallet + drains buffer or admin bag)
CREATE OR REPLACE FUNCTION public.admin_release_pending_payout(p_pending_id uuid, p_source text DEFAULT 'pool')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_pool numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can release pending payouts';
  END IF;

  SELECT * INTO p FROM public.pending_driver_payouts WHERE id = p_pending_id FOR UPDATE;
  IF NOT FOUND OR p.resolved THEN
    RAISE EXCEPTION 'Pending payout not found or already resolved';
  END IF;

  IF p_source = 'pool' THEN
    SELECT COALESCE(platform_pool,0) INTO v_pool FROM public.admin_treasury WHERE id=1;
    IF v_pool < p.amount THEN
      RAISE EXCEPTION 'Driver Buffer ανεπαρκές (διαθέσιμο €%, χρειάζεται €%)', v_pool, p.amount;
    END IF;
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool - p.amount,
          lifetime_driver_topup = lifetime_driver_topup + p.amount,
          updated_at = now()
      WHERE id = 1;
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (-p.amount, 'platform', 'driver_payout', p.order_id, 'Pending payout released from pool');
  ELSE
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance - p.amount,
          updated_at = now()
      WHERE id = 1;
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (-p.amount, 'admin', 'driver_subsidy', p.order_id, 'Pending payout released from admin');
  END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance)
  VALUES (p.driver_id, p.amount)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = public.driver_wallets.available_balance + p.amount,
        updated_at = now();

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
  VALUES (p.driver_id, 'earning_credit', p.amount, 'completed', 'Pending payout released', p.order_id);

  UPDATE public.pending_driver_payouts
    SET resolved = true, resolved_at = now(), resolved_by = auth.uid()
    WHERE id = p.id;

  RETURN jsonb_build_object('ok', true, 'amount', p.amount);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_release_pending_payout(uuid, text) TO authenticated;
