-- =========================================================
-- Money Bags: Stores, Admin Treasury, Driver Cash Debts
-- =========================================================

-- ---------- STORE WALLETS ----------
CREATE TABLE IF NOT EXISTS public.store_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE,
  available_balance numeric NOT NULL DEFAULT 0,
  pending_balance numeric NOT NULL DEFAULT 0,
  lifetime_earnings numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Store owners view own wallet"
  ON public.store_wallets FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_wallets.store_id AND s.owner_id = auth.uid()));

CREATE POLICY "Admins view all store wallets"
  ON public.store_wallets FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage store wallets"
  ON public.store_wallets FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER store_wallets_updated
  BEFORE UPDATE ON public.store_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- STORE WALLET LEDGER ----------
CREATE TABLE IF NOT EXISTS public.store_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  order_id uuid,
  type text NOT NULL,        -- order_earning, payout, adjustment, cash_settled
  amount numeric NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.store_wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Store owners view own ledger"
  ON public.store_wallet_ledger FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_wallet_ledger.store_id AND s.owner_id = auth.uid()));

CREATE POLICY "Admins manage store ledger"
  ON public.store_wallet_ledger FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_store_ledger_store ON public.store_wallet_ledger(store_id, created_at DESC);

-- ---------- ADMIN TREASURY (single platform money bag) ----------
CREATE TABLE IF NOT EXISTS public.admin_treasury (
  id integer PRIMARY KEY DEFAULT 1,
  admin_balance numeric NOT NULL DEFAULT 0,         -- 5% admin cut
  platform_pool numeric NOT NULL DEFAULT 0,         -- 10% remaining commission (used to top-up drivers)
  lifetime_admin_earned numeric NOT NULL DEFAULT 0,
  lifetime_platform_earned numeric NOT NULL DEFAULT 0,
  lifetime_driver_topup numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

INSERT INTO public.admin_treasury (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.admin_treasury ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view treasury"
  ON public.admin_treasury FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update treasury"
  ON public.admin_treasury FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- ADMIN TREASURY LEDGER ----------
CREATE TABLE IF NOT EXISTS public.admin_treasury_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  type text NOT NULL,        -- admin_fee, platform_fee, driver_topup, store_payout, cash_settled, adjustment
  bag text NOT NULL,         -- 'admin' or 'platform'
  amount numeric NOT NULL,   -- positive = credit, negative = debit
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.admin_treasury_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage treasury ledger"
  ON public.admin_treasury_ledger FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_treasury_ledger_created ON public.admin_treasury_ledger(created_at DESC);

-- ---------- DRIVER CASH DEBTS ----------
CREATE TABLE IF NOT EXISTS public.driver_cash_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  order_id uuid,
  cash_collected numeric NOT NULL DEFAULT 0,    -- total cash driver received from customer
  driver_share numeric NOT NULL DEFAULT 0,      -- driver's earnings (kept from the cash)
  store_share numeric NOT NULL DEFAULT 0,       -- owed to store
  admin_share numeric NOT NULL DEFAULT 0,       -- owed to admin (5%)
  platform_share numeric NOT NULL DEFAULT 0,    -- owed to platform pool (10% minus topup)
  amount_owed numeric NOT NULL DEFAULT 0,       -- = store + admin + platform
  settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  settled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_cash_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers view own debts"
  ON public.driver_cash_debts FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "Admins manage cash debts"
  ON public.driver_cash_debts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Support view cash debts"
  ON public.driver_cash_debts FOR SELECT
  USING (public.is_support_or_admin(auth.uid()));

CREATE INDEX idx_cash_debts_driver ON public.driver_cash_debts(driver_id, settled, created_at DESC);

-- =========================================================
-- SETTLEMENT FUNCTION (runs on order delivered)
-- =========================================================
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
BEGIN
  -- Only on transition to delivered
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Skip if already settled (re-trigger safety)
  IF EXISTS (SELECT 1 FROM store_wallet_ledger WHERE order_id = NEW.id AND type = 'order_earning') THEN
    RETURN NEW;
  END IF;

  v_food_total := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip := COALESCE(NEW.tip_amount, 0);
  v_is_cash := (NEW.payment_method = 'cash');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay := COALESCE(v_settings.min_pay, 3);

  -- 15% commission split: 5% admin + 10% platform pool
  v_total_commission := ROUND(v_food_total * 0.15, 2);
  v_admin_cut := ROUND(v_food_total * 0.05, 2);
  v_platform_cut := v_total_commission - v_admin_cut;
  v_store_share := v_food_total - v_total_commission;

  -- Driver fairness: driver should get max(min_pay, delivery_fee + tip)
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    -- Top-up comes out of platform pool first
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  -- ---- STORE WALLET ----
  INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
  VALUES (NEW.store_id, v_store_share, v_store_share)
  ON CONFLICT (store_id) DO UPDATE
    SET available_balance = store_wallets.available_balance + v_store_share,
        lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
        updated_at = now();

  INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
  VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
          'Order ' || COALESCE(NEW.external_ref, NEW.id::text) || ' (85% of ' || v_food_total || ')');

  -- ---- ADMIN TREASURY ----
  UPDATE admin_treasury
    SET admin_balance = admin_balance + v_admin_cut,
        platform_pool = platform_pool + v_platform_cut,
        lifetime_admin_earned = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut, '5% admin cut');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          '10% platform pool' || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ driver top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup, 'Top-up to guarantee fair driver pay');
  END IF;

  -- ---- DRIVER WALLET (always fair pay) ----
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance) VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay (delivery ' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- ---- CASH HANDLING ----
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    -- Driver pocketed the cash. They owe back: store + admin + platform (minus their own share already covered by cash)
    -- Cash collected = food_total + delivery_fee. Driver keeps v_driver_target. Owes the rest.
    v_amount_owed := (v_food_total + v_delivery_fee) - v_driver_target;
    INSERT INTO driver_cash_debts (
      driver_id, order_id, cash_collected, driver_share,
      store_share, admin_share, platform_share, amount_owed
    ) VALUES (
      NEW.driver_id, NEW.id, v_food_total + v_delivery_fee, v_driver_target,
      v_store_share, v_admin_cut, GREATEST(v_platform_cut, 0), v_amount_owed
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settle_money_bags_on_delivery ON public.orders;
CREATE TRIGGER settle_money_bags_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_order_money_bags();

-- =========================================================
-- ADMIN ACTIONS: settle cash debt, payout store
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_settle_driver_cash(p_debt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_debt driver_cash_debts%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can settle cash';
  END IF;
  SELECT * INTO v_debt FROM driver_cash_debts WHERE id = p_debt_id AND NOT settled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Debt not found or already settled'; END IF;

  -- Move cash into the proper bags
  UPDATE admin_treasury
    SET admin_balance = admin_balance + v_debt.admin_share,
        platform_pool = platform_pool + v_debt.platform_share,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (v_debt.order_id, 'cash_settled', 'admin', v_debt.admin_share, 'Cash settlement from driver'),
         (v_debt.order_id, 'cash_settled', 'platform', v_debt.platform_share, 'Cash settlement from driver');

  INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description, created_by)
  SELECT o.store_id, v_debt.order_id, 'cash_settled', v_debt.store_share,
         'Cash from driver settlement', auth.uid()
  FROM orders o WHERE o.id = v_debt.order_id;

  -- Reset driver shift cash (admin acknowledges receipt)
  UPDATE driver_state
    SET shift_cash_balance = GREATEST(0, shift_cash_balance - v_debt.amount_owed),
        updated_at = now()
    WHERE driver_id = v_debt.driver_id;

  UPDATE driver_cash_debts
    SET settled = true, settled_at = now(), settled_by = auth.uid()
    WHERE id = p_debt_id;

  PERFORM log_admin_action('settle_driver_cash', 'driver', v_debt.driver_id::text,
    'Settled ' || v_debt.amount_owed || '€ cash debt', jsonb_build_object('debt_id', p_debt_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_payout_store(p_store_id uuid, p_amount numeric, p_description text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can pay out stores';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT available_balance INTO v_balance FROM store_wallets WHERE store_id = p_store_id;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient store balance';
  END IF;

  UPDATE store_wallets
    SET available_balance = available_balance - p_amount,
        updated_at = now()
    WHERE store_id = p_store_id;

  INSERT INTO store_wallet_ledger (store_id, type, amount, description, created_by)
  VALUES (p_store_id, 'payout', -p_amount, COALESCE(p_description, 'Admin payout'), auth.uid());

  PERFORM log_admin_action('payout_store', 'store', p_store_id::text,
    'Paid out ' || p_amount || '€ to store', '{}'::jsonb);
END;
$$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_treasury;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_cash_debts;
