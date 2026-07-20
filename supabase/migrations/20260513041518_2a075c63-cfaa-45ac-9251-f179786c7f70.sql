CREATE TABLE IF NOT EXISTS public.service_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL UNIQUE,
  center_latitude double precision NOT NULL,
  center_longitude double precision NOT NULL,
  radius_km numeric NOT NULL DEFAULT 5 CHECK (radius_km > 0 AND radius_km <= 50),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active zones"
  ON public.service_zones FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage zones - insert"
  ON public.service_zones FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage zones - update"
  ON public.service_zones FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage zones - delete"
  ON public.service_zones FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_service_zones_updated_at
  BEFORE UPDATE ON public.service_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_point_in_any_zone(p_lat double precision, p_lng double precision)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hit boolean;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN true; END IF;
  -- if no zones defined yet, allow everything (avoid bricking the platform)
  IF NOT EXISTS (SELECT 1 FROM public.service_zones WHERE is_active) THEN
    RETURN true;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.service_zones z
    WHERE z.is_active
      AND (
        2 * 6371 * asin(sqrt(
          power(sin(radians((p_lat - z.center_latitude) / 2)), 2)
          + cos(radians(z.center_latitude)) * cos(radians(p_lat))
            * power(sin(radians((p_lng - z.center_longitude) / 2)), 2)
        ))
      ) <= z.radius_km
  ) INTO hit;
  RETURN hit;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_order_in_service_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_latitude IS NULL OR NEW.delivery_longitude IS NULL THEN
    RETURN NEW; -- allow orders without coords (legacy / scheduled)
  END IF;
  IF NOT public.is_point_in_any_zone(NEW.delivery_latitude, NEW.delivery_longitude) THEN
    RAISE EXCEPTION 'Η διεύθυνση παράδοσης βρίσκεται εκτός ζώνης κάλυψης.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_order_in_zone ON public.orders;
CREATE TRIGGER trg_enforce_order_in_zone
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_in_service_zone();