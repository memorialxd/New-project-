CREATE OR REPLACE FUNCTION public.guard_picked_up_requires_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status::text = 'picked_up'
     AND OLD.status::text NOT IN ('ready', 'arrived', 'picked_up') THEN
    RAISE EXCEPTION 'Order must be marked ready by the store before pickup'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_picked_up_requires_ready ON public.orders;
CREATE TRIGGER trg_guard_picked_up_requires_ready
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_picked_up_requires_ready();