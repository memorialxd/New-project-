CREATE OR REPLACE FUNCTION public.validate_store_billing_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ext_billing_mode NOT IN ('tiered','commission','flat_fee','driver_plus_margin') THEN
    RAISE EXCEPTION 'Invalid ext_billing_mode: %', NEW.ext_billing_mode;
  END IF;
  RETURN NEW;
END;
$$;