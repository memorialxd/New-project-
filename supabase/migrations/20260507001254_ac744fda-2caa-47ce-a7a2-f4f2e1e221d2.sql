-- 1. Bulk-settle all open driver cash debts in one call
CREATE OR REPLACE FUNCTION public.admin_settle_all_driver_cash()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d record;
  v_count integer := 0;
  v_total numeric := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can bulk-settle cash';
  END IF;

  FOR d IN SELECT id, amount_owed FROM public.driver_cash_debts WHERE NOT settled LOOP
    PERFORM public.admin_settle_driver_cash(d.id);
    v_count := v_count + 1;
    v_total := v_total + COALESCE(d.amount_owed, 0);
  END LOOP;

  PERFORM public.log_admin_action('bulk_settle_cash', 'treasury', NULL,
    'Bulk-settled ' || v_count || ' debts (' || v_total || '€)',
    jsonb_build_object('count', v_count, 'total', v_total));

  RETURN jsonb_build_object('settled', v_count, 'total', v_total);
END;
$$;

-- 2. Auto-close previous month (idempotent)
CREATE OR REPLACE FUNCTION public.admin_auto_close_previous_month()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start date := (date_trunc('month', now()) - interval '1 month')::date;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM public.monthly_reports WHERE period_start = v_start LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  -- Only admins can call directly; cron job runs as table owner so SECURITY DEFINER bypass is via separate wrapper
  RETURN public.admin_close_month(v_start);
END;
$$;

-- 3. Low-pool threshold setting + health check
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS low_pool_threshold numeric NOT NULL DEFAULT 50;

CREATE OR REPLACE FUNCTION public.get_treasury_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t admin_treasury%ROWTYPE;
  ps platform_settings%ROWTYPE;
  v_open_debts numeric;
  v_open_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO t FROM admin_treasury WHERE id = 1;
  SELECT * INTO ps FROM platform_settings WHERE id = 1;
  SELECT COALESCE(SUM(amount_owed), 0), COUNT(*) INTO v_open_debts, v_open_count
    FROM driver_cash_debts WHERE NOT settled;

  RETURN jsonb_build_object(
    'pool_balance', t.platform_pool,
    'pool_low', t.platform_pool < COALESCE(ps.low_pool_threshold, 50),
    'pool_negative', t.platform_pool < 0,
    'threshold', COALESCE(ps.low_pool_threshold, 50),
    'open_cash_debts_total', v_open_debts,
    'open_cash_debts_count', v_open_count
  );
END;
$$;

-- 4. Schedule auto month-close via pg_cron (1st of month, 03:00 UTC)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-previous-month') THEN
    PERFORM cron.unschedule('auto-close-previous-month');
  END IF;
  PERFORM cron.schedule(
    'auto-close-previous-month',
    '0 3 1 * *',
    $cron$ SELECT public.admin_auto_close_previous_month(); $cron$
  );
END $$;