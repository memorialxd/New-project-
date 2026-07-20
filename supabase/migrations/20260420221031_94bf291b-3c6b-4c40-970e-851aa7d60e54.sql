ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS distribution_mode text NOT NULL DEFAULT 'nearest',
  ADD COLUMN IF NOT EXISTS dist_search_radius_km numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dist_offer_timeout_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS dist_wave_size integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dist_max_waves integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dist_vehicle_rules_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dist_bike_max_km numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dist_motorcycle_max_km numeric NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS dist_car_min_value numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS dist_min_driver_rating numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_min_acceptance_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_fairness_weight numeric NOT NULL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS dist_rating_weight numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS dist_distance_weight numeric NOT NULL DEFAULT 0.3;

-- Validate distribution_mode values
CREATE OR REPLACE FUNCTION public.validate_distribution_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.distribution_mode NOT IN ('nearest','broadcast','batched','smart') THEN
    RAISE EXCEPTION 'Invalid distribution_mode: %', NEW.distribution_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_distribution_mode ON public.platform_settings;
CREATE TRIGGER trg_validate_distribution_mode
BEFORE INSERT OR UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_distribution_mode();