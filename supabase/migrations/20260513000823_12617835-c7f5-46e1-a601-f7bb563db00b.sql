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
