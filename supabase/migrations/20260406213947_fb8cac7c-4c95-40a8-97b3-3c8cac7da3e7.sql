-- Add unique driver code to driver_profiles
ALTER TABLE public.driver_profiles
ADD COLUMN driver_code TEXT UNIQUE;

-- Create sequence for driver codes
CREATE SEQUENCE IF NOT EXISTS driver_code_seq START WITH 1;

-- Auto-generate driver_code on insert
CREATE OR REPLACE FUNCTION public.generate_driver_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.driver_code IS NULL THEN
    NEW.driver_code := 'DRV-' || LPAD(nextval('driver_code_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_driver_code
BEFORE INSERT ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.generate_driver_code();

-- Backfill existing driver_profiles with codes
UPDATE public.driver_profiles
SET driver_code = 'DRV-' || LPAD(nextval('driver_code_seq')::TEXT, 4, '0')
WHERE driver_code IS NULL;

-- Prevent store owners from changing is_active on their own store (admin only)
CREATE OR REPLACE FUNCTION public.protect_store_active_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If is_active is being changed, only allow admins
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Μόνο οι διαχειριστές μπορούν να ενεργοποιήσουν/απενεργοποιήσουν καταστήματα';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_store_active
BEFORE UPDATE ON public.stores
FOR EACH ROW
EXECUTE FUNCTION public.protect_store_active_status();