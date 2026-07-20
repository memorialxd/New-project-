
ALTER TABLE public.driver_profiles
ADD COLUMN layout text NOT NULL DEFAULT 'default';

-- Trigger to protect layout field - only admins can change it
CREATE OR REPLACE FUNCTION public.protect_driver_layout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.layout IS DISTINCT FROM NEW.layout THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change driver layout';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_driver_layout_trigger
BEFORE UPDATE ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_driver_layout();
