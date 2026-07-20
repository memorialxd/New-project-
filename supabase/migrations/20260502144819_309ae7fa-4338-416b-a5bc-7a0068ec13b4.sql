CREATE OR REPLACE FUNCTION public.set_predicted_ready_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.predicted_ready_at IS NULL AND NEW.store_id IS NOT NULL THEN
    NEW.predicted_ready_at := public.predict_ready_at(NEW.store_id, COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_predicted_ready_at ON public.orders;
CREATE TRIGGER trg_set_predicted_ready_at
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_predicted_ready_at();