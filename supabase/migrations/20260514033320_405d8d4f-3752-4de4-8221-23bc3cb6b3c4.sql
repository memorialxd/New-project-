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