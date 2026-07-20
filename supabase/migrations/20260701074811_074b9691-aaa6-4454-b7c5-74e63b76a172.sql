CREATE OR REPLACE FUNCTION public.validate_driver_offer_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.action NOT IN ('accepted','declined','timed_out','viewed','released') THEN
    RAISE EXCEPTION 'Invalid action: %', NEW.action;
  END IF;
  RETURN NEW;
END;
$function$;