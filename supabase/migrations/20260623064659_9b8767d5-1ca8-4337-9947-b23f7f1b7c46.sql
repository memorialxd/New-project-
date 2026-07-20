CREATE OR REPLACE FUNCTION public.validate_distribution_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.distribution_mode NOT IN ('nearest','broadcast','batched','smart','fair_earnings') THEN
    RAISE EXCEPTION 'Invalid distribution_mode: %', NEW.distribution_mode;
  END IF;
  RETURN NEW;
END;
$$;