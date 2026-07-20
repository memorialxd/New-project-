-- Pending offers table
CREATE TABLE public.pending_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  wave INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | expired | cancelled
  distance_km NUMERIC,
  score NUMERIC,
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, driver_id, wave)
);

CREATE INDEX idx_pending_offers_driver_status ON public.pending_offers(driver_id, status);
CREATE INDEX idx_pending_offers_order_status ON public.pending_offers(order_id, status);
CREATE INDEX idx_pending_offers_expires ON public.pending_offers(expires_at) WHERE status = 'pending';

ALTER TABLE public.pending_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers view own pending offers"
ON public.pending_offers FOR SELECT
USING (auth.uid() = driver_id);

CREATE POLICY "Drivers update own pending offers"
ON public.pending_offers FOR UPDATE
USING (auth.uid() = driver_id)
WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Support and admins view all offers"
ON public.pending_offers FOR SELECT
USING (is_support_or_admin(auth.uid()));

CREATE POLICY "Admins manage all offers"
ON public.pending_offers FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Realtime so the driver app gets new offers instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_offers;

-- Helper: rank nearby active drivers for a given pickup point
-- Returns drivers sorted by a composite score (lower = better)
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  _store_lat DOUBLE PRECISION,
  _store_lng DOUBLE PRECISION,
  _order_value NUMERIC DEFAULT 0,
  _exclude_drivers UUID[] DEFAULT ARRAY[]::UUID[],
  _limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  driver_id UUID,
  distance_km NUMERIC,
  vehicle_type TEXT,
  score NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;

  RETURN QUERY
  WITH driver_pool AS (
    SELECT
      dp.user_id AS drv_id,
      COALESCE(dp.vehicle_type, 'motorcycle') AS v_type,
      dl.latitude AS lat,
      dl.longitude AS lng,
      -- Simple haversine in km
      (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_store_lat)) * cos(radians(dl.latitude)) *
          cos(radians(dl.longitude) - radians(_store_lng)) +
          sin(radians(_store_lat)) * sin(radians(dl.latitude))
        ))
      ))::NUMERIC AS dist_km,
      COALESCE(ds.on_break, false) AS on_brk
    FROM driver_profiles dp
    JOIN driver_locations dl ON dl.driver_id = dp.user_id
    LEFT JOIN driver_state ds ON ds.driver_id = dp.user_id
    WHERE dp.is_active = true
      AND dp.suspended_at IS NULL
      AND dl.updated_at > now() - INTERVAL '5 minutes'
      AND NOT (dp.user_id = ANY(_exclude_drivers))
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.driver_id = dp.user_id
          AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pending_offers po
        WHERE po.driver_id = dp.user_id AND po.status = 'pending'
      )
  )
  SELECT
    dp.drv_id,
    ROUND(dp.dist_km, 2),
    dp.v_type,
    -- Composite score: distance weight only for now (rating/acceptance can be layered later)
    ROUND(dp.dist_km * COALESCE(s.dist_distance_weight, 0.3) * 10, 3) AS score
  FROM driver_pool dp
  WHERE dp.on_brk = false
    AND dp.dist_km <= COALESCE(s.dist_search_radius_km, 5)
    AND (
      NOT COALESCE(s.dist_vehicle_rules_enabled, false)
      OR (
        (dp.v_type = 'bike' AND dp.dist_km <= COALESCE(s.dist_bike_max_km, 3))
        OR (dp.v_type = 'motorcycle' AND dp.dist_km <= COALESCE(s.dist_motorcycle_max_km, 8))
        OR (dp.v_type = 'car' AND _order_value >= COALESCE(s.dist_car_min_value, 25))
        OR dp.v_type NOT IN ('bike','motorcycle','car')
      )
    )
  ORDER BY score ASC, dp.dist_km ASC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nearby_active_drivers TO authenticated, service_role;