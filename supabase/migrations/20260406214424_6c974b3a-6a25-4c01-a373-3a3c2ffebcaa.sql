-- Add is_active to driver_profiles
ALTER TABLE public.driver_profiles
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Prevent drivers from changing their own is_active status
CREATE OR REPLACE FUNCTION public.protect_driver_active_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Μόνο οι διαχειριστές μπορούν να ενεργοποιήσουν/απενεργοποιήσουν οδηγούς';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_driver_active
BEFORE UPDATE ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_driver_active_status();