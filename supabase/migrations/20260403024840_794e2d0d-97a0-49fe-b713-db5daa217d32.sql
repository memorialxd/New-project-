
CREATE OR REPLACE FUNCTION public.assign_random_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  random_driver_id UUID;
BEGIN
  -- Only assign if no driver is set and status is pending or placed
  IF NEW.driver_id IS NULL AND NEW.status IN ('pending', 'placed') THEN
    SELECT p.user_id INTO random_driver_id
    FROM public.profiles p
    WHERE p.role = 'driver'
    ORDER BY random()
    LIMIT 1;

    IF random_driver_id IS NOT NULL THEN
      NEW.driver_id := random_driver_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_assign_random_driver
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_random_driver();
