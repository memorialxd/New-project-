-- Source: 20260513000514_2c3b53e6-31ce-4702-8b02-e80d8b923416.sql
-- =========================================================================
-- PHASE 1: Unified Ledger Overlay + Surge Engine Foundation
-- =========================================================================

-- 1) TRANSACTIONS (overlay, immutable)
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_kind text NOT NULL CHECK (wallet_kind IN ('driver','store','customer','admin','basket')),
  wallet_owner_id uuid,
  amount numeric NOT NULL,
  type text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  surge_event_id uuid,
  balance_after numeric,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_owner_kind_created ON public.transactions(wallet_kind, wallet_owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_order ON public.transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_tx_created ON public.transactions(created_at DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all transactions"
  ON public.transactions FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Drivers view own tx"
  ON public.transactions FOR SELECT
  USING (wallet_kind = 'driver' AND wallet_owner_id = auth.uid());

CREATE POLICY "Customers view own tx"
  ON public.transactions FOR SELECT
  USING (wallet_kind = 'customer' AND wallet_owner_id = auth.uid());

CREATE POLICY "Store owners view own store tx"
  ON public.transactions FOR SELECT
  USING (wallet_kind = 'store' AND EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = transactions.wallet_owner_id AND s.owner_id = auth.uid()
  ));

-- No INSERT/UPDATE/DELETE policies => append-only via SECURITY DEFINER triggers only.

-- 2) SURGE EVENTS (history)
CREATE TABLE IF NOT EXISTS public.surge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.demand_zones(id) ON DELETE CASCADE,
  multiplier numeric NOT NULL DEFAULT 1.0,
  source text NOT NULL CHECK (source IN ('auto','manual','time','weather')),
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_surge_events_zone_active ON public.surge_events(zone_id, started_at DESC);
ALTER TABLE public.surge_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage surge events" ON public.surge_events FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Drivers view active surge" ON public.surge_events FOR SELECT
  USING (has_role(auth.uid(),'driver'::app_role) AND (ends_at IS NULL OR ends_at > now()));

-- 3) SURGE OVERRIDES (admin manual)
CREATE TABLE IF NOT EXISTS public.surge_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.demand_zones(id) ON DELETE CASCADE,
  multiplier numeric NOT NULL DEFAULT 1.0,
  mode text NOT NULL DEFAULT 'force' CHECK (mode IN ('force','freeze','disable')),
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_surge_overrides_zone_active ON public.surge_overrides(zone_id, is_active);
ALTER TABLE public.surge_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage surge overrides" ON public.surge_overrides FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 4) ORDERS: record what surge was applied
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS surge_multiplier_used numeric NOT NULL DEFAULT 1.0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS surge_event_id uuid;

-- 5) PLATFORM_SETTINGS: surge config
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS surge_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS surge_default_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS surge_time_peak_multiplier numeric NOT NULL DEFAULT 1.25,
  ADD COLUMN IF NOT EXISTS surge_ratio_low_threshold numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS surge_ratio_high_threshold numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS surge_ratio_high_multiplier numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS surge_ratio_extreme_multiplier numeric NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS surge_floor_multiplier numeric NOT NULL DEFAULT 0.8;

-- 6) RPC: current_surge_for_zone (manual override > time > zone ratio > default)
CREATE OR REPLACE FUNCTION public.current_surge_for_zone(_zone_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  ps RECORD;
  ov RECORD;
  z RECORD;
  ratio numeric;
  mult numeric;
  src text;
  reason text;
  hr int;
  dow int;
  in_peak boolean;
BEGIN
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;
  IF ps IS NULL OR NOT COALESCE(ps.surge_enabled, true) THEN
    RETURN jsonb_build_object('multiplier', 1.0, 'source', 'disabled', 'reason', 'surge disabled');
  END IF;

  -- 1) Manual override
  SELECT * INTO ov FROM public.surge_overrides
   WHERE zone_id = _zone_id AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF ov.mode = 'disable' THEN
      RETURN jsonb_build_object('multiplier', 1.0, 'source','manual','reason', COALESCE(ov.reason,'admin disabled'));
    END IF;
    RETURN jsonb_build_object('multiplier', ov.multiplier, 'source','manual','reason', COALESCE(ov.reason,'admin override'));
  END IF;

  mult := ps.surge_default_multiplier;
  src := 'default';
  reason := 'baseline';

  -- 2) Time window peak
  hr := EXTRACT(HOUR FROM now() AT TIME ZONE 'Europe/Athens')::int;
  dow := EXTRACT(ISODOW FROM now() AT TIME ZONE 'Europe/Athens')::int;
  in_peak := false;
  IF ps.peak_start_hour IS NOT NULL AND ps.peak_end_hour IS NOT NULL THEN
    IF dow = ANY(COALESCE(ps.peak_weekdays, ARRAY[1,2,3,4,5,6,7])) THEN
      IF ps.peak_start_hour <= ps.peak_end_hour THEN
        in_peak := hr >= ps.peak_start_hour AND hr < ps.peak_end_hour;
      ELSE
        in_peak := hr >= ps.peak_start_hour OR hr < ps.peak_end_hour;
      END IF;
    END IF;
  END IF;
  IF in_peak THEN
    mult := GREATEST(mult, ps.surge_time_peak_multiplier);
    src := 'time'; reason := 'peak hours';
  END IF;

  -- 3) Zone supply/demand ratio (orders/drivers)
  SELECT * INTO z FROM public.demand_zones WHERE id = _zone_id;
  IF FOUND AND z.driver_count > 0 THEN
    ratio := z.order_count::numeric / GREATEST(z.driver_count, 1);
    IF ratio >= ps.surge_ratio_high_threshold * 2 THEN
      mult := GREATEST(mult, ps.surge_ratio_extreme_multiplier);
      src := 'auto'; reason := format('extreme demand ratio %.2f', ratio);
    ELSIF ratio >= ps.surge_ratio_high_threshold THEN
      mult := GREATEST(mult, ps.surge_ratio_high_multiplier);
      src := 'auto'; reason := format('high demand ratio %.2f', ratio);
    ELSIF ratio < ps.surge_ratio_low_threshold THEN
      mult := LEAST(mult, GREATEST(ps.surge_floor_multiplier, 0.5));
      src := 'auto'; reason := format('low demand ratio %.2f', ratio);
    END IF;
  END IF;

  RETURN jsonb_build_object('multiplier', mult, 'source', src, 'reason', reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_surge_for_zone(uuid) TO authenticated;

-- 7) RPC: open_surge_event (admin convenience to start an event)
CREATE OR REPLACE FUNCTION public.open_surge_event(_zone_id uuid, _multiplier numeric, _source text, _reason text, _ends_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin only'; END IF;
  INSERT INTO public.surge_events (zone_id, multiplier, source, reason, ends_at, created_by)
  VALUES (_zone_id, _multiplier, _source, _reason, _ends_at, auth.uid())
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.open_surge_event(uuid,numeric,text,text,timestamptz) TO authenticated;

-- =========================================================================
-- LEDGER MIRROR TRIGGERS
-- =========================================================================

-- Append a row to transactions. SECURITY DEFINER so it bypasses missing INSERT policy.
CREATE OR REPLACE FUNCTION public.tx_append(
  _kind text, _owner uuid, _amount numeric, _type text,
  _order_id uuid, _balance_after numeric, _description text, _meta jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _amount IS NULL OR _amount = 0 THEN RETURN; END IF;
  INSERT INTO public.transactions (wallet_kind, wallet_owner_id, amount, type, order_id, balance_after, description, metadata)
  VALUES (_kind, _owner, _amount, _type, _order_id, _balance_after, _description, COALESCE(_meta,'{}'::jsonb));
END $$;

-- Driver wallets diff
CREATE OR REPLACE FUNCTION public.tx_mirror_driver_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.available_balance,0);
  ELSE
    delta := COALESCE(NEW.available_balance,0) - COALESCE(OLD.available_balance,0);
  END IF;
  IF delta <> 0 THEN
    PERFORM public.tx_append('driver', NEW.driver_id, delta,
      CASE WHEN delta > 0 THEN 'wallet_credit' ELSE 'wallet_debit' END,
      NULL, NEW.available_balance, 'driver_wallet sync');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_driver_wallet ON public.driver_wallets;
CREATE TRIGGER trg_tx_driver_wallet AFTER INSERT OR UPDATE OF available_balance ON public.driver_wallets
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_driver_wallet();

-- Store wallets diff
CREATE OR REPLACE FUNCTION public.tx_mirror_store_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.available_balance,0);
  ELSE
    delta := COALESCE(NEW.available_balance,0) - COALESCE(OLD.available_balance,0);
  END IF;
  IF delta <> 0 THEN
    PERFORM public.tx_append('store', NEW.store_id, delta,
      CASE WHEN delta > 0 THEN 'wallet_credit' ELSE 'wallet_debit' END,
      NULL, NEW.available_balance, 'store_wallet sync');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_store_wallet ON public.store_wallets;
CREATE TRIGGER trg_tx_store_wallet AFTER INSERT OR UPDATE OF available_balance ON public.store_wallets
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_store_wallet();

-- Customer wallets diff
CREATE OR REPLACE FUNCTION public.tx_mirror_customer_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.balance,0);
  ELSE
    delta := COALESCE(NEW.balance,0) - COALESCE(OLD.balance,0);
  END IF;
  IF delta <> 0 THEN
    PERFORM public.tx_append('customer', NEW.user_id, delta,
      CASE WHEN delta > 0 THEN 'wallet_credit' ELSE 'wallet_debit' END,
      NULL, NEW.balance, 'customer_wallet sync');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_customer_wallet ON public.customer_wallets;
CREATE TRIGGER trg_tx_customer_wallet AFTER INSERT OR UPDATE OF balance ON public.customer_wallets
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_customer_wallet();

-- Admin treasury ledger -> mirror to admin / basket transactions
CREATE OR REPLACE FUNCTION public.tx_mirror_treasury_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  kind text;
  bal numeric;
  t RECORD;
BEGIN
  -- 'admin' bag => admin wallet ; 'platform' bag => basket (driver pool)
  IF NEW.bag = 'admin' THEN kind := 'admin'; ELSE kind := 'basket'; END IF;
  SELECT admin_balance, platform_pool INTO t FROM public.admin_treasury WHERE id = 1;
  bal := CASE WHEN kind='admin' THEN t.admin_balance ELSE t.platform_pool END;
  PERFORM public.tx_append(kind, NULL, NEW.amount, NEW.type, NEW.order_id, bal,
    COALESCE(NEW.description, NEW.type), jsonb_build_object('treasury_ledger_id', NEW.id, 'bag', NEW.bag));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_treasury_ledger ON public.admin_treasury_ledger;
CREATE TRIGGER trg_tx_treasury_ledger AFTER INSERT ON public.admin_treasury_ledger
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_treasury_ledger();

-- =========================================================================
-- SETTLEMENT HOOK: stamp surge multiplier on order
-- =========================================================================
CREATE OR REPLACE FUNCTION public.stamp_order_surge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  zone RECORD;
  res jsonb;
BEGIN
  IF NEW.surge_multiplier_used IS NOT NULL AND NEW.surge_multiplier_used <> 1.0 THEN RETURN NEW; END IF;
  IF NEW.delivery_latitude IS NULL OR NEW.delivery_longitude IS NULL THEN RETURN NEW; END IF;
  -- Find nearest active zone within radius
  SELECT *, (
    6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(NEW.delivery_latitude)) * cos(radians(latitude)) *
      cos(radians(longitude) - radians(NEW.delivery_longitude)) +
      sin(radians(NEW.delivery_latitude)) * sin(radians(latitude))
    )))
  ) AS dist_km
  INTO zone
  FROM public.demand_zones
  WHERE is_active = true
  ORDER BY dist_km ASC LIMIT 1;
  IF zone.id IS NOT NULL AND zone.dist_km <= COALESCE(zone.radius_km, 1.0) THEN
    res := public.current_surge_for_zone(zone.id);
    NEW.surge_multiplier_used := COALESCE((res->>'multiplier')::numeric, 1.0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_order_surge ON public.orders;
CREATE TRIGGER trg_stamp_order_surge BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.stamp_order_surge();


-- Source: 20260513000823_12617835-c7f5-46e1-a601-f7bb563db00b.sql
-- =========================================================================
-- PHASE 2: Driver Basket distribution engine
-- =========================================================================

-- 1) Distribution RULES (admin-defined, repeatable)
CREATE TABLE IF NOT EXISTS public.basket_distribution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('top_drivers','milestone','tenure','performance','manual')),
  schedule text NOT NULL DEFAULT 'manual' CHECK (schedule IN ('weekly','monthly','manual')),
  -- allocation: either a flat amount OR a % of basket OR per-recipient amount
  amount_mode text NOT NULL DEFAULT 'percent' CHECK (amount_mode IN ('flat_total','percent_of_basket','per_recipient')),
  amount_value numeric NOT NULL DEFAULT 10,
  -- config: kind-specific JSON (e.g. {top_n:5, period_days:7} or {threshold:100} or {months:6})
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.basket_distribution_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage basket rules" ON public.basket_distribution_rules
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 2) Distribution RUNS (one per execution)
CREATE TABLE IF NOT EXISTS public.basket_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.basket_distribution_rules(id) ON DELETE SET NULL,
  rule_name text,
  total_amount numeric NOT NULL DEFAULT 0,
  recipient_count int NOT NULL DEFAULT 0,
  basket_balance_before numeric,
  basket_balance_after numeric,
  triggered_by text NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual','schedule')),
  notes text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.basket_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view basket distributions" ON public.basket_distributions
  FOR SELECT USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins insert basket distributions" ON public.basket_distributions
  FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 3) Per-driver PAYOUT line items
CREATE TABLE IF NOT EXISTS public.basket_distribution_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL REFERENCES public.basket_distributions(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  amount numeric NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_basket_payouts_driver ON public.basket_distribution_payouts(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_basket_payouts_distribution ON public.basket_distribution_payouts(distribution_id);
ALTER TABLE public.basket_distribution_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view basket payouts" ON public.basket_distribution_payouts
  FOR SELECT USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Drivers view own basket payouts" ON public.basket_distribution_payouts
  FOR SELECT USING (auth.uid() = driver_id);

-- =========================================================================
-- 4) RPC: run_basket_distribution(rule_id)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.run_basket_distribution(_rule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
  pool_before numeric;
  pool_after numeric;
  total_to_distribute numeric := 0;
  per_recipient numeric;
  recipients RECORD;
  recipient_ids uuid[] := ARRAY[]::uuid[];
  amounts numeric[] := ARRAY[]::numeric[];
  reasons text[] := ARRAY[]::text[];
  d_id uuid; amt numeric; rsn text;
  i int;
  dist_id uuid;
  cnt int := 0;
  cfg jsonb;
  top_n int;
  period_days int;
  threshold int;
  months int;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO r FROM public.basket_distribution_rules WHERE id = _rule_id AND is_active = true;
  IF r IS NULL THEN RAISE EXCEPTION 'rule not found or inactive'; END IF;

  SELECT COALESCE(platform_pool,0) INTO pool_before FROM public.admin_treasury WHERE id = 1;
  cfg := r.config;

  -- ---------- Compute recipients per kind ----------
  IF r.kind = 'top_drivers' THEN
    top_n := COALESCE((cfg->>'top_n')::int, 5);
    period_days := COALESCE((cfg->>'period_days')::int, 7);
    FOR recipients IN
      SELECT o.driver_id, COUNT(*)::int AS deliveries
        FROM public.orders o
       WHERE o.driver_id IS NOT NULL
         AND o.status::text = 'delivered'
         AND o.created_at >= now() - make_interval(days => period_days)
       GROUP BY o.driver_id
       ORDER BY deliveries DESC
       LIMIT top_n
    LOOP
      recipient_ids := array_append(recipient_ids, recipients.driver_id);
      reasons := array_append(reasons, format('Top driver: %s deliveries (last %sd)', recipients.deliveries, period_days));
    END LOOP;

  ELSIF r.kind = 'milestone' THEN
    threshold := COALESCE((cfg->>'threshold')::int, 100);
    -- drivers who hit a deliveries-count milestone since last_run
    FOR recipients IN
      WITH counts AS (
        SELECT driver_id, COUNT(*)::int AS total
          FROM public.orders
         WHERE driver_id IS NOT NULL AND status::text = 'delivered'
         GROUP BY driver_id
      )
      SELECT driver_id, total
        FROM counts
       WHERE total >= threshold
         AND total < threshold * 2
         AND NOT EXISTS (
           SELECT 1 FROM public.basket_distribution_payouts bp
            JOIN public.basket_distributions bd ON bd.id = bp.distribution_id
           WHERE bp.driver_id = counts.driver_id
             AND bd.rule_id = _rule_id
         )
    LOOP
      recipient_ids := array_append(recipient_ids, recipients.driver_id);
      reasons := array_append(reasons, format('Milestone: %s deliveries', recipients.total));
    END LOOP;

  ELSIF r.kind = 'tenure' THEN
    months := COALESCE((cfg->>'months')::int, 6);
    FOR recipients IN
      SELECT dp.user_id AS driver_id,
             EXTRACT(MONTH FROM age(now(), dp.created_at))::int AS m
        FROM public.driver_profiles dp
       WHERE dp.is_active = true
         AND dp.created_at <= now() - make_interval(months => months)
         AND NOT EXISTS (
           SELECT 1 FROM public.basket_distribution_payouts bp
            JOIN public.basket_distributions bd ON bd.id = bp.distribution_id
           WHERE bp.driver_id = dp.user_id
             AND bd.rule_id = _rule_id
             AND bp.created_at > now() - interval '30 days'
         )
    LOOP
      recipient_ids := array_append(recipient_ids, recipients.driver_id);
      reasons := array_append(reasons, format('Tenure: %s months', months));
    END LOOP;

  ELSIF r.kind = 'performance' THEN
    -- avg rating >= cfg.min_rating (default 4.5), at least cfg.min_deliveries (default 20) in period
    period_days := COALESCE((cfg->>'period_days')::int, 30);
    FOR recipients IN
      SELECT o.driver_id,
             AVG(COALESCE(rv.rating,5))::numeric(3,2) AS avg_r,
             COUNT(*)::int AS dels
        FROM public.orders o
        LEFT JOIN public.reviews rv ON rv.order_id = o.id
       WHERE o.driver_id IS NOT NULL
         AND o.status::text = 'delivered'
         AND o.created_at >= now() - make_interval(days => period_days)
       GROUP BY o.driver_id
      HAVING COUNT(*) >= COALESCE((cfg->>'min_deliveries')::int, 20)
         AND AVG(COALESCE(rv.rating,5)) >= COALESCE((cfg->>'min_rating')::numeric, 4.5)
    LOOP
      recipient_ids := array_append(recipient_ids, recipients.driver_id);
      reasons := array_append(reasons, format('Performance: %s★ over %s deliveries', recipients.avg_r, recipients.dels));
    END LOOP;

  ELSIF r.kind = 'manual' THEN
    -- expects cfg = {driver_ids: [uuid,...]}
    FOR recipients IN
      SELECT jsonb_array_elements_text(cfg->'driver_ids')::uuid AS driver_id
    LOOP
      recipient_ids := array_append(recipient_ids, recipients.driver_id);
      reasons := array_append(reasons, COALESCE(cfg->>'reason','Manual distribution'));
    END LOOP;
  END IF;

  cnt := COALESCE(array_length(recipient_ids,1),0);
  IF cnt = 0 THEN
    UPDATE public.basket_distribution_rules SET last_run_at = now(), updated_at = now() WHERE id = _rule_id;
    RETURN jsonb_build_object('ok', true, 'recipients', 0, 'note', 'no eligible recipients');
  END IF;

  -- ---------- Compute amounts ----------
  IF r.amount_mode = 'flat_total' THEN
    total_to_distribute := LEAST(r.amount_value, pool_before);
    per_recipient := ROUND((total_to_distribute / cnt)::numeric, 2);
  ELSIF r.amount_mode = 'percent_of_basket' THEN
    total_to_distribute := ROUND((pool_before * r.amount_value / 100.0)::numeric, 2);
    per_recipient := ROUND((total_to_distribute / cnt)::numeric, 2);
  ELSE -- per_recipient
    per_recipient := r.amount_value;
    total_to_distribute := ROUND((per_recipient * cnt)::numeric, 2);
    IF total_to_distribute > pool_before THEN
      per_recipient := ROUND((pool_before / cnt)::numeric, 2);
      total_to_distribute := per_recipient * cnt;
    END IF;
  END IF;

  IF total_to_distribute <= 0 THEN
    UPDATE public.basket_distribution_rules SET last_run_at = now(), updated_at = now() WHERE id = _rule_id;
    RETURN jsonb_build_object('ok', false, 'note', 'basket empty or amount = 0');
  END IF;

  -- ---------- Open distribution row ----------
  INSERT INTO public.basket_distributions
    (rule_id, rule_name, total_amount, recipient_count, basket_balance_before, triggered_by, created_by, snapshot)
  VALUES
    (_rule_id, r.name, total_to_distribute, cnt, pool_before, 'manual', auth.uid(),
     jsonb_build_object('rule_kind', r.kind, 'amount_mode', r.amount_mode, 'amount_value', r.amount_value, 'config', cfg))
  RETURNING id INTO dist_id;

  -- Debit pool ONCE (bypasses guard via tx_session flag)
  PERFORM set_config('app.basket_distribution_active','1', true);
  UPDATE public.admin_treasury
     SET platform_pool = platform_pool - total_to_distribute,
         updated_at = now()
   WHERE id = 1;
  PERFORM set_config('app.basket_distribution_active','0', true);

  INSERT INTO public.admin_treasury_ledger (amount, bag, type, description)
  VALUES (-total_to_distribute, 'platform', 'basket_distribution',
          format('Distribution %s: %s (%s recipients)', r.name, r.kind, cnt));

  -- ---------- Credit each driver + insert payout line ----------
  FOR i IN 1..cnt LOOP
    d_id := recipient_ids[i];
    amt := per_recipient;
    rsn := reasons[i];

    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (d_id, amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + amt,
          updated_at = now();

    INSERT INTO public.basket_distribution_payouts (distribution_id, driver_id, amount, reason)
    VALUES (dist_id, d_id, amt, rsn);

    -- Driver-facing notification
    INSERT INTO public.driver_notifications (driver_id, sender_id, title, body, severity)
    VALUES (d_id, auth.uid(),
            format('🎁 Basket bonus: €%s', amt),
            COALESCE(rsn, r.name), 'success');
  END LOOP;

  SELECT COALESCE(platform_pool,0) INTO pool_after FROM public.admin_treasury WHERE id = 1;
  UPDATE public.basket_distributions
     SET basket_balance_after = pool_after
   WHERE id = dist_id;

  UPDATE public.basket_distribution_rules
     SET last_run_at = now(), updated_at = now() WHERE id = _rule_id;

  INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), 'admin', 'basket_distribution', 'driver_basket', dist_id::text,
          format('Distributed €%s to %s drivers (%s)', total_to_distribute, cnt, r.name),
          jsonb_build_object('rule_id', _rule_id, 'rule_kind', r.kind));

  RETURN jsonb_build_object(
    'ok', true,
    'distribution_id', dist_id,
    'recipients', cnt,
    'total', total_to_distribute,
    'per_recipient', per_recipient,
    'pool_before', pool_before,
    'pool_after', pool_after
  );
END $$;

GRANT EXECUTE ON FUNCTION public.run_basket_distribution(uuid) TO authenticated;

-- =========================================================================
-- 5) HARD GUARD: only-grows except via distribution
-- =========================================================================
CREATE OR REPLACE FUNCTION public.guard_basket_only_grows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta numeric;
  is_distribution boolean;
BEGIN
  delta := COALESCE(NEW.platform_pool,0) - COALESCE(OLD.platform_pool,0);
  IF delta >= 0 THEN RETURN NEW; END IF;

  -- A negative delta is only allowed when a distribution is actively running.
  is_distribution := COALESCE(current_setting('app.basket_distribution_active', true), '0') = '1';
  IF is_distribution THEN RETURN NEW; END IF;

  -- Permit existing settle_order_commission per-order driver bonus (already audited via ledger row),
  -- and admin month-close. Detect by checking that an admin_treasury_ledger row was written
  -- in the same statement with a negative platform amount.
  IF EXISTS (
    SELECT 1 FROM public.admin_treasury_ledger
     WHERE bag = 'platform'
       AND amount < 0
       AND created_at > now() - interval '5 seconds'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Driver basket can only decrease via run_basket_distribution() or audited treasury ledger entry';
END $$;
DROP TRIGGER IF EXISTS trg_guard_basket ON public.admin_treasury;
CREATE TRIGGER trg_guard_basket
  BEFORE UPDATE OF platform_pool ON public.admin_treasury
  FOR EACH ROW EXECUTE FUNCTION public.guard_basket_only_grows();

-- =========================================================================
-- 6) Convenience view: basket health
-- =========================================================================
CREATE OR REPLACE VIEW public.basket_health AS
SELECT
  t.platform_pool                                       AS current_balance,
  t.lifetime_platform_earned                            AS lifetime_in,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions),0) AS lifetime_distributed,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions
             WHERE created_at >= now() - interval '7 days'),0)            AS distributed_7d,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions
             WHERE created_at >= now() - interval '30 days'),0)           AS distributed_30d,
  (SELECT MAX(created_at) FROM public.basket_distributions)               AS last_distribution_at
FROM public.admin_treasury t WHERE t.id = 1;

GRANT SELECT ON public.basket_health TO authenticated;

-- 7) Seed two starter rules (inactive — admin enables when ready)
INSERT INTO public.basket_distribution_rules (name, kind, schedule, amount_mode, amount_value, config, is_active)
VALUES
  ('Top 5 drivers (weekly)', 'top_drivers', 'weekly', 'percent_of_basket', 10, '{"top_n":5,"period_days":7}'::jsonb, false),
  ('100-delivery milestone', 'milestone', 'manual', 'per_recipient', 25, '{"threshold":100}'::jsonb, false)
ON CONFLICT DO NOTHING;


-- Source: 20260513000838_98b1b798-45c5-40e9-9c80-50967696a490.sql
DROP VIEW IF EXISTS public.basket_health;
CREATE VIEW public.basket_health
WITH (security_invoker = true) AS
SELECT
  t.platform_pool                                       AS current_balance,
  t.lifetime_platform_earned                            AS lifetime_in,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions),0) AS lifetime_distributed,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions
             WHERE created_at >= now() - interval '7 days'),0)            AS distributed_7d,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions
             WHERE created_at >= now() - interval '30 days'),0)           AS distributed_30d,
  (SELECT MAX(created_at) FROM public.basket_distributions)               AS last_distribution_at
FROM public.admin_treasury t WHERE t.id = 1;
GRANT SELECT ON public.basket_health TO authenticated;

-- Source: 20260513023446_4d90a31c-07ee-471d-9504-d6d6bf08e886.sql

CREATE OR REPLACE FUNCTION public.run_due_basket_distributions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  ran integer := 0;
BEGIN
  FOR r IN
    SELECT id, schedule
    FROM public.basket_distribution_rules
    WHERE is_active = true
      AND schedule IN ('weekly', 'monthly')
      AND (next_run_at IS NULL OR next_run_at <= now())
  LOOP
    BEGIN
      PERFORM public.run_basket_distribution(r.id);
      UPDATE public.basket_distribution_rules
      SET next_run_at = CASE
            WHEN r.schedule = 'weekly'  THEN now() + interval '7 days'
            WHEN r.schedule = 'monthly' THEN now() + interval '1 month'
            ELSE next_run_at
          END,
          last_run_at = now()
      WHERE id = r.id;
      ran := ran + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
      VALUES (
        '00000000-0000-0000-0000-000000000000'::uuid,
        'basket_auto_distribution_failed',
        'basket_rule', r.id::text,
        SQLERRM, jsonb_build_object('rule_id', r.id)
      );
    END;
  END LOOP;
  RETURN ran;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_due_basket_distributions() TO service_role;


-- Source: 20260513023735_4fc86528-0185-4ebf-9de4-2d79aa0c4718.sql

CREATE OR REPLACE FUNCTION public.log_surge_override_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.surge_events(zone_id, multiplier, source, reason, ends_at, created_by)
    VALUES (NEW.zone_id, NEW.multiplier, 'manual', NEW.reason, NEW.expires_at, NEW.created_by);

    INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
    VALUES (
      COALESCE(NEW.created_by, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'surge_override_created',
      'surge_override', NEW.id::text,
      'Manual surge override ×' || NEW.multiplier::text,
      jsonb_build_object('zone_id', NEW.zone_id, 'multiplier', NEW.multiplier, 'expires_at', NEW.expires_at, 'reason', NEW.reason)
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'surge_override_cancelled',
      'surge_override', OLD.id::text,
      'Cancelled surge override ×' || OLD.multiplier::text,
      jsonb_build_object('zone_id', OLD.zone_id, 'multiplier', OLD.multiplier)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_surge_override_audit ON public.surge_overrides;
CREATE TRIGGER trg_surge_override_audit
AFTER INSERT OR DELETE ON public.surge_overrides
FOR EACH ROW EXECUTE FUNCTION public.log_surge_override_change();


-- Source: 20260513030412_cdb5ced1-4fb8-4b30-b3d3-b2093e351cc8.sql

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_balance_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS basket_target_balance numeric NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS basket_max_surcharge_pct numeric NOT NULL DEFAULT 5;

CREATE OR REPLACE FUNCTION public.compute_order_split(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders%ROWTYPE;
  s public.stores%ROWTYPE;
  ps public.platform_settings%ROWTYPE;
  food_subtotal numeric;
  base_total_comm_pct numeric;
  total_comm_pct numeric;
  admin_pct numeric;
  pool_pct numeric;
  pool_pct_floor numeric;
  store_extra_pct numeric;
  delivery_fee numeric;
  store_pays_delivery boolean;
  basket_balance numeric;
  surcharge_pct numeric := 0;
  deficit_ratio numeric := 0;
  res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.stores WHERE id = o.store_id;
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;

  delivery_fee := COALESCE(o.delivery_fee, 0);
  food_subtotal := GREATEST(COALESCE(o.total_amount, 0) - delivery_fee - COALESCE(o.tip_amount, 0), 0);

  base_total_comm_pct := GREATEST(COALESCE(s.commission_pct, ps.default_commission_pct, 15), 15);
  admin_pct      := GREATEST(COALESCE(ps.admin_share_pct, 5), 5);
  pool_pct_floor := GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10);
  pool_pct       := pool_pct_floor;
  total_comm_pct := base_total_comm_pct;

  -- Smart auto-balance: when basket is below target, raise commission charged to store
  -- and route the surcharge entirely into the driver basket. Capped by basket_max_surcharge_pct.
  IF COALESCE(ps.auto_balance_enabled, true) THEN
    SELECT COALESCE(platform_pool, 0) INTO basket_balance FROM public.admin_treasury WHERE id = 1;
    IF basket_balance < COALESCE(ps.basket_target_balance, 500) AND COALESCE(ps.basket_target_balance,0) > 0 THEN
      deficit_ratio := LEAST(1.0, (ps.basket_target_balance - basket_balance) / ps.basket_target_balance);
      surcharge_pct := round(deficit_ratio * COALESCE(ps.basket_max_surcharge_pct, 0), 2);
      pool_pct       := pool_pct + surcharge_pct;
      total_comm_pct := total_comm_pct + surcharge_pct;
    END IF;
  END IF;

  store_extra_pct := GREATEST(total_comm_pct - admin_pct - pool_pct, 0);
  store_pays_delivery := COALESCE(s.covers_delivery_fee, false);

  res := jsonb_build_object(
    'food_subtotal', food_subtotal,
    'delivery_fee', delivery_fee,
    'tip_amount', COALESCE(o.tip_amount, 0),
    'total_commission_pct', total_comm_pct,
    'admin_pct', admin_pct,
    'driver_pool_pct', pool_pct,
    'driver_pool_pct_floor', pool_pct_floor,
    'auto_balance_surcharge_pct', surcharge_pct,
    'store_extra_commission_pct', store_extra_pct,
    'admin_amount', round(food_subtotal * admin_pct / 100, 2),
    'driver_pool_amount', round(food_subtotal * pool_pct / 100, 2),
    'store_extra_commission', round(food_subtotal * store_extra_pct / 100, 2),
    'store_keeps', round(food_subtotal * (100 - total_comm_pct) / 100, 2),
    'store_pays_delivery', store_pays_delivery,
    'driver_delivery_fee', delivery_fee,
    'driver_tip', COALESCE(o.tip_amount, 0)
  );
  RETURN res;
END;
$function$;


-- Source: 20260513031214_f614406f-e9af-467d-9196-d31af0047b68.sql

UPDATE public.platform_settings
SET auto_balance_enabled = false, basket_max_surcharge_pct = 0
WHERE id = 1;

CREATE OR REPLACE FUNCTION public.compute_order_split(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders%ROWTYPE;
  s public.stores%ROWTYPE;
  ps public.platform_settings%ROWTYPE;
  food_subtotal numeric;
  total_comm_pct numeric;
  admin_pct numeric;
  pool_pct numeric;
  store_extra_pct numeric;
  delivery_fee numeric;
  store_pays_delivery boolean;
  res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.stores WHERE id = o.store_id;
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;

  delivery_fee := COALESCE(o.delivery_fee, 0);
  food_subtotal := GREATEST(COALESCE(o.total_amount, 0) - delivery_fee - COALESCE(o.tip_amount, 0), 0);

  total_comm_pct := GREATEST(COALESCE(s.commission_pct, ps.default_commission_pct, 15), 15);
  admin_pct := GREATEST(COALESCE(ps.admin_share_pct, 5), 5);
  pool_pct  := GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10);
  store_extra_pct := GREATEST(total_comm_pct - admin_pct - pool_pct, 0);

  store_pays_delivery := COALESCE(s.covers_delivery_fee, false);

  res := jsonb_build_object(
    'food_subtotal', food_subtotal,
    'delivery_fee', delivery_fee,
    'tip_amount', COALESCE(o.tip_amount, 0),
    'total_commission_pct', total_comm_pct,
    'admin_pct', admin_pct,
    'driver_pool_pct', pool_pct,
    'driver_pool_pct_floor', pool_pct,
    'auto_balance_surcharge_pct', 0,
    'store_extra_commission_pct', store_extra_pct,
    'admin_amount', round(food_subtotal * admin_pct / 100, 2),
    'driver_pool_amount', round(food_subtotal * pool_pct / 100, 2),
    'store_extra_commission', round(food_subtotal * store_extra_pct / 100, 2),
    'store_keeps', round(food_subtotal * (100 - total_comm_pct) / 100, 2),
    'store_pays_delivery', store_pays_delivery,
    'driver_delivery_fee', delivery_fee,
    'driver_tip', COALESCE(o.tip_amount, 0)
  );
  RETURN res;
END;
$function$;


-- Source: 20260513035233_415d16f3-17d0-4c34-8cf0-629d84e47cee.sql

-- 1. STORES: hide financial columns from non-admins
REVOKE SELECT (commission_pct, ext_commission_pct, ext_margin_pct,
               ext_flat_fee, suspension_reason, promotion_amount_paid)
  ON public.stores FROM anon, authenticated;

-- 2. COMMISSION_TIERS
DROP POLICY IF EXISTS "Admins and store owners read commission tiers" ON public.commission_tiers;
DROP POLICY IF EXISTS "Authenticated can read commission tiers" ON public.commission_tiers;
CREATE POLICY "Admins read commission tiers"
ON public.commission_tiers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. STORE_PRICING_OVERRIDES
DROP POLICY IF EXISTS "Admins and store owners can view overrides" ON public.store_pricing_overrides;
CREATE POLICY "Admins view pricing overrides"
ON public.store_pricing_overrides FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. GROUP_ORDERS
DROP POLICY IF EXISTS "Anyone authed can view by share code" ON public.group_orders;
CREATE POLICY "Host, participants and staff view group orders"
ON public.group_orders FOR SELECT TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_order_participants p
    WHERE p.group_order_id = group_orders.id AND p.user_id = auth.uid()
  )
  OR public.is_support_or_admin(auth.uid())
);

-- 5. GROUP_ORDER_PARTICIPANTS
DROP POLICY IF EXISTS "Authed users can view participants" ON public.group_order_participants;
CREATE POLICY "Group members and staff view participants"
ON public.group_order_participants FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_orders g
    WHERE g.id = group_order_participants.group_order_id
      AND (g.host_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.group_order_participants p2
             WHERE p2.group_order_id = g.id AND p2.user_id = auth.uid()
           ))
  )
  OR public.is_support_or_admin(auth.uid())
);

-- 6. STORAGE: fix broken store-owner order-proof policy
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;
CREATE POLICY "Store owners view their order proofs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'order-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND (storage.foldername(name))[1] = o.id::text
  )
);


-- Source: 20260513040858_4cf3063d-cdf5-4442-90b5-36d96d588bbd.sql
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
  s RECORD;
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
        -- FIX: write audit ledger BEFORE decrementing pool, so guard sees it
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
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND NOT is_cash THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.driver_payout := COALESCE(bonus_amt, 0) + CASE WHEN NOT is_cash THEN COALESCE(delivery_amt, 0) ELSE 0 END;
  NEW.store_charge := COALESCE((split->>'store_commission')::numeric, 0);

  RETURN NEW;
END $function$;

-- Source: 20260513040911_c25782b7-31dc-49f7-b45b-0ff08a941161.sql
DO $$
DECLARE
  v_order_id uuid := '26178fef-73aa-465d-9764-b37827acda26';
  v_driver_id uuid := '3fbd26ff-f356-4cb9-903d-2854bf9d09ba';
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_driver_id, 'driver')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.orders SET driver_id=v_driver_id, status='accepted', dispatch_at=now() WHERE id=v_order_id;
  UPDATE public.orders SET status='preparing' WHERE id=v_order_id;
  UPDATE public.orders SET status='ready' WHERE id=v_order_id;
  UPDATE public.orders SET status='picked_up' WHERE id=v_order_id;
  UPDATE public.orders SET status='delivered' WHERE id=v_order_id;
END $$;

-- Source: 20260513041518_2a075c63-cfaa-45ac-9251-f179786c7f70.sql
CREATE TABLE IF NOT EXISTS public.service_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL UNIQUE,
  center_latitude double precision NOT NULL,
  center_longitude double precision NOT NULL,
  radius_km numeric NOT NULL DEFAULT 5 CHECK (radius_km > 0 AND radius_km <= 50),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active zones"
  ON public.service_zones FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage zones - insert"
  ON public.service_zones FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage zones - update"
  ON public.service_zones FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage zones - delete"
  ON public.service_zones FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_service_zones_updated_at
  BEFORE UPDATE ON public.service_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_point_in_any_zone(p_lat double precision, p_lng double precision)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hit boolean;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN true; END IF;
  -- if no zones defined yet, allow everything (avoid bricking the platform)
  IF NOT EXISTS (SELECT 1 FROM public.service_zones WHERE is_active) THEN
    RETURN true;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.service_zones z
    WHERE z.is_active
      AND (
        2 * 6371 * asin(sqrt(
          power(sin(radians((p_lat - z.center_latitude) / 2)), 2)
          + cos(radians(z.center_latitude)) * cos(radians(p_lat))
            * power(sin(radians((p_lng - z.center_longitude) / 2)), 2)
        ))
      ) <= z.radius_km
  ) INTO hit;
  RETURN hit;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_order_in_service_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_latitude IS NULL OR NEW.delivery_longitude IS NULL THEN
    RETURN NEW; -- allow orders without coords (legacy / scheduled)
  END IF;
  IF NOT public.is_point_in_any_zone(NEW.delivery_latitude, NEW.delivery_longitude) THEN
    RAISE EXCEPTION 'Η διεύθυνση παράδοσης βρίσκεται εκτός ζώνης κάλυψης.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_order_in_zone ON public.orders;
CREATE TRIGGER trg_enforce_order_in_zone
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_in_service_zone();

-- Source: 20260513041952_67b0141d-5fd7-41b6-91e7-2d45982edf0d.sql

-- Drop legacy duplicate-payout triggers; settle_order_commission is canonical
DROP TRIGGER IF EXISTS settle_money_bags_on_delivery ON public.orders;
DROP TRIGGER IF EXISTS trg_auto_earning_on_delivery ON public.orders;

-- Reverse the 8€ over-credit on the test order
DO $$
DECLARE
  v_driver uuid := '3fbd26ff-f356-4cb9-903d-2854bf9d09ba';
  v_order  uuid := '26178fef-73aa-465d-9764-b37827acda26';
  v_over   numeric := 8.00;
BEGIN
  UPDATE public.driver_wallets
    SET available_balance = GREATEST(available_balance - v_over, 0),
        updated_at = now()
    WHERE driver_id = v_driver;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
  VALUES (v_driver, 'admin_debit', -v_over, 'completed',
          'Reversal: legacy duplicate payout (Fair pay 3€ + Delivery 5€)', v_order);
END $$;


-- Source: 20260514013247_8d95d89c-7ffb-4c47-8b1e-75a68b5974dd.sql
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

-- Source: 20260514020252_81ee978c-e3a3-47a1-b88a-f16ebbf0ab8a.sql

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
  tip_amt numeric;
  store_extra numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  pool_take numeric;
  is_cash boolean;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  amount_owed numeric := 0;
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
  tip_amt      := COALESCE(NEW.tip_amount, 0);
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
    END IF;

    driver_share_total := COALESCE(bonus_amt, 0)
                        + COALESCE(delivery_amt, 0)
                        + COALESCE(tip_amt, 0);

    IF is_cash THEN
      -- Cash: driver already has the money in hand. Don't credit wallet.
      -- Instead record what they owe back to admin (cash collected minus their share).
      cash_collected := COALESCE(NEW.cash_received, NEW.total_amount, 0);
      amount_owed := GREATEST(cash_collected - driver_share_total, 0);

      INSERT INTO public.driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share,
        amount_owed, settled
      ) VALUES (
        NEW.driver_id, NEW.id, cash_collected,
        driver_share_total,
        COALESCE((split->>'store_keeps')::numeric, 0),
        admin_amt,
        pool_amt + store_extra,
        amount_owed,
        false
      );
    ELSE
      -- Card: credit driver wallet with bonus + delivery fee + tip
      IF driver_share_total > 0 THEN
        INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
        VALUES (NEW.driver_id, driver_share_total, 0, 0)
        ON CONFLICT (driver_id) DO UPDATE
          SET available_balance = public.driver_wallets.available_balance + driver_share_total,
              updated_at = now();

        IF bonus_amt > 0 THEN
          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          VALUES (NEW.driver_id, 'earning_credit', bonus_amt, 'completed',
                  'Πληρωμή παράδοσης (driver pool)', NEW.id);
        END IF;
        IF delivery_amt > 0 THEN
          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          VALUES (NEW.driver_id, 'earning_credit', delivery_amt, 'completed',
                  'Delivery fee', NEW.id);
        END IF;
        IF tip_amt > 0 THEN
          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          VALUES (NEW.driver_id, 'earning_credit', tip_amt, 'completed',
                  'Tip', NEW.id);
        END IF;
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := COALESCE((split->>'store_commission')::numeric, 0);

  RETURN NEW;
END $function$;


-- Source: 20260514022527_9d21f052-bc53-4feb-bf0e-9f0228428c91.sql
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  tip_amt numeric;
  store_extra numeric;
  store_keeps_amt numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  pool_take numeric;
  is_cash boolean;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  amount_owed numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);
  pays_delivery   := COALESCE((split->>'store_pays_delivery')::boolean, false);

  -- ADMIN bag
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- PLATFORM POOL (driver pool top-up)
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Extra store commission (>15%) → platform pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- ★ STORE WALLET — credit the store's share for every delivered order
  IF store_keeps_amt > 0 THEN
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (NEW.store_id, store_keeps_amt, 0, store_keeps_amt)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
          lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
          updated_at = now();

    INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', store_keeps_amt,
            CASE WHEN is_cash THEN 'Μερίδιο καταστήματος (μετρητά)'
                 ELSE 'Μερίδιο καταστήματος (κάρτα)' END);
  END IF;

  -- DRIVER share
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
    END IF;

    driver_share_total := COALESCE(bonus_amt, 0)
                        + COALESCE(delivery_amt, 0)
                        + COALESCE(tip_amt, 0);

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, NEW.total_amount, 0);
      amount_owed := GREATEST(cash_collected - driver_share_total, 0);

      INSERT INTO public.driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share,
        amount_owed, settled
      ) VALUES (
        NEW.driver_id, NEW.id, cash_collected,
        driver_share_total, store_keeps_amt, admin_amt,
        pool_amt + store_extra, amount_owed, false
      );
    ELSE
      IF driver_share_total > 0 THEN
        INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
        VALUES (NEW.driver_id, driver_share_total, 0, 0)
        ON CONFLICT (driver_id) DO UPDATE
          SET available_balance = public.driver_wallets.available_balance + driver_share_total,
              updated_at = now();

        IF bonus_amt > 0 THEN
          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          VALUES (NEW.driver_id, 'earning_credit', bonus_amt, 'completed',
                  'Πληρωμή παράδοσης (driver pool)', NEW.id);
        END IF;
        IF delivery_amt > 0 THEN
          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          VALUES (NEW.driver_id, 'earning_credit', delivery_amt, 'completed',
                  'Delivery fee', NEW.id);
        END IF;
        IF tip_amt > 0 THEN
          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          VALUES (NEW.driver_id, 'earning_credit', tip_amt, 'completed',
                  'Tip', NEW.id);
        END IF;
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := bonus_amt;

  RETURN NEW;
END;
$$;

-- Backfill: credit store wallets for past delivered orders that were missed.
DO $$
DECLARE
  o RECORD;
  split jsonb;
  store_keeps_amt numeric;
BEGIN
  FOR o IN
    SELECT ord.id, ord.store_id, ord.payment_method
      FROM public.orders ord
     WHERE ord.status = 'delivered'
       AND ord.commission_settled_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.store_wallet_ledger swl
          WHERE swl.order_id = ord.id AND swl.type = 'order_earning'
       )
  LOOP
    split := public.compute_order_split(o.id);
    store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);
    IF store_keeps_amt > 0 THEN
      INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
      VALUES (o.store_id, store_keeps_amt, 0, store_keeps_amt)
      ON CONFLICT (store_id) DO UPDATE
        SET available_balance = public.store_wallets.available_balance + store_keeps_amt,
            lifetime_earnings = public.store_wallets.lifetime_earnings + store_keeps_amt,
            updated_at = now();

      INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
      VALUES (o.store_id, o.id, 'order_earning', store_keeps_amt,
              'Backfill: μερίδιο καταστήματος που δεν είχε πιστωθεί');
    END IF;
  END LOOP;
END $$;

-- Source: 20260514032121_ddb85d64-f7e0-4a6f-ab77-2f8428724dc3.sql
CREATE OR REPLACE FUNCTION public.bump_driver_shift_cash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.amount_owed > 0 AND NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.driver_state (driver_id, shift_cash_balance, shift_started_at)
    VALUES (NEW.driver_id, NEW.amount_owed, COALESCE((SELECT shift_started_at FROM public.driver_state WHERE driver_id = NEW.driver_id), now()))
    ON CONFLICT (driver_id) DO UPDATE
      SET shift_cash_balance = public.driver_state.shift_cash_balance + NEW.amount_owed,
          shift_started_at = COALESCE(public.driver_state.shift_started_at, now()),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_driver_shift_cash_on_debt ON public.driver_cash_debts;
CREATE TRIGGER bump_driver_shift_cash_on_debt
AFTER INSERT ON public.driver_cash_debts
FOR EACH ROW
EXECUTE FUNCTION public.bump_driver_shift_cash();

-- Source: 20260514032827_56b922d6-d2d6-4fcd-bf68-927ebbf9740d.sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-dispatch-every-30s') THEN
    PERFORM cron.unschedule('auto-dispatch-every-30s');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-dispatch-every-minute') THEN
    PERFORM cron.unschedule('auto-dispatch-every-minute');
  END IF;
END $$;

-- Source: 20260514033320_405d8d4f-3752-4de4-8221-23bc3cb6b3c4.sql
-- Add admin-controlled toggle: auto-pause driver bonus when basket pool is critical
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pause_bonus_when_critical boolean NOT NULL DEFAULT false;

-- Rewrite bonus calculator to respect the auto-pause flag
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
  paused boolean := false;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT base_pay, per_km_rate, min_pay, max_pay,
         pool_healthy_threshold, low_pool_threshold, pool_critical_threshold,
         pool_low_multiplier, pool_critical_multiplier,
         subsidize_min_pay, pause_bonus_when_critical
    INTO s FROM public.platform_settings WHERE id = 1;

  SELECT COALESCE(platform_pool, 0) INTO pool FROM public.admin_treasury WHERE id = 1;

  IF pool >= s.pool_healthy_threshold THEN
    mult := 1.0; health := 'healthy';
  ELSIF pool >= s.low_pool_threshold THEN
    mult := 1.0; health := 'normal';
  ELSIF pool >= s.pool_critical_threshold THEN
    mult := s.pool_low_multiplier; health := 'low';
  ELSE
    mult := s.pool_critical_multiplier; health := 'critical';
  END IF;

  raw_amt  := COALESCE(s.base_pay,0) + COALESCE(s.per_km_rate,0) * COALESCE(o.distance_km,0);
  clamped  := LEAST(GREATEST(raw_amt, s.min_pay), s.max_pay);
  final_amt := GREATEST(clamped * mult, s.min_pay);

  -- Auto-pause: if basket is critical AND admin opted in, pay zero bonus (unless subsidy is on)
  IF health = 'critical' AND COALESCE(s.pause_bonus_when_critical, false) THEN
    paused := true;
    IF COALESCE(s.subsidize_min_pay, false) THEN
      final_amt := s.min_pay;
      subsidy := s.min_pay;
    ELSE
      final_amt := 0;
    END IF;
  ELSIF final_amt > pool THEN
    -- Pool insolvency guard
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
    'paused',        paused,
    'distance_km',   COALESCE(o.distance_km, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_driver_pool_bonus(uuid) TO authenticated;

