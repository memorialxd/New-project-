-- 1. Columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prep_minutes_actual numeric,
  ADD COLUMN IF NOT EXISTS predicted_ready_at timestamptz;

-- 2. Trigger: capture actual prep time at ready
CREATE OR REPLACE FUNCTION public.capture_prep_duration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ready' AND COALESCE(OLD.status::text, '') <> 'ready'
     AND NEW.prep_minutes_actual IS NULL THEN
    NEW.prep_minutes_actual :=
      GREATEST(0, EXTRACT(EPOCH FROM (now() - NEW.created_at)) / 60.0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_prep_duration ON public.orders;
CREATE TRIGGER trg_capture_prep_duration
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.capture_prep_duration();

-- 3. Improved historical average using the new column (median, last 50 orders)
CREATE OR REPLACE FUNCTION public.get_store_avg_prep_minutes(p_store_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY prep_minutes_actual)
     FROM (
       SELECT prep_minutes_actual
       FROM public.orders
       WHERE store_id = p_store_id
         AND prep_minutes_actual IS NOT NULL
         AND prep_minutes_actual BETWEEN 1 AND 120
       ORDER BY created_at DESC
       LIMIT 50
     ) s),
    20
  )::numeric;
$$;

-- 4. Predicted ready time helper (used by client + dispatcher)
CREATE OR REPLACE FUNCTION public.predict_ready_at(p_store_id uuid, p_created_at timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_min numeric;
  load_count int;
  total_min numeric;
BEGIN
  base_min := public.get_store_avg_prep_minutes(p_store_id);
  SELECT COUNT(*) INTO load_count
  FROM public.orders
  WHERE store_id = p_store_id
    AND status IN ('placed','accepted','preparing');
  total_min := base_min + GREATEST(0, load_count - 2) * 1.5;
  total_min := LEAST(120, GREATEST(5, total_min));
  RETURN p_created_at + (total_min || ' minutes')::interval;
END;
$$;

GRANT EXECUTE ON FUNCTION public.predict_ready_at(uuid, timestamptz) TO authenticated;