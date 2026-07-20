CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  _store_lat double precision,
  _store_lng double precision,
  _order_value numeric DEFAULT 0,
  _exclude_drivers uuid[] DEFAULT ARRAY[]::uuid[],
  _limit integer DEFAULT 10,
  _store_id uuid DEFAULT NULL::uuid,
  _dropoff_lat double precision DEFAULT NULL,
  _dropoff_lng double precision DEFAULT NULL
)
RETURNS TABLE(driver_id uuid, distance_km numeric, vehicle_type text, score numeric, active_orders integer, is_stack boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  max_stack INT;
  near_km NUMERIC := 0.6; -- ~600m considered "same route / same address"
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;
  max_stack := GREATEST(1, COALESCE(s.max_stacked_orders, 1));

  RETURN QUERY
  WITH driver_pool AS (
    SELECT
      dp.user_id AS drv_id,
      COALESCE(dp.vehicle_type, 'motorcycle') AS v_type,
      dl.latitude AS lat,
      dl.longitude AS lng,
      (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_store_lat)) * cos(radians(dl.latitude)) *
          cos(radians(dl.longitude) - radians(_store_lng)) +
          sin(radians(_store_lat)) * sin(radians(dl.latitude))
        ))
      ))::NUMERIC AS dist_km,
      COALESCE(ds.on_break, false) AS on_brk,
      (
        SELECT COUNT(*)::INT FROM orders o
        WHERE o.driver_id = dp.user_id
          AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
      ) AS active_cnt,
      (
        _store_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.driver_id = dp.user_id
            AND o.status IN ('accepted','preparing','ready','arrived')
            AND o.store_id = _store_id
        )
      ) AS same_store,
      (
        _dropoff_lat IS NOT NULL AND _dropoff_lng IS NOT NULL AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.driver_id = dp.user_id
            AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
            AND o.delivery_latitude IS NOT NULL
            AND o.delivery_longitude IS NOT NULL
            AND (6371 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians(_dropoff_lat)) * cos(radians(o.delivery_latitude)) *
                cos(radians(o.delivery_longitude) - radians(_dropoff_lng)) +
                sin(radians(_dropoff_lat)) * sin(radians(o.delivery_latitude))
              ))
            )) <= near_km
        )
      ) AS same_dropoff
    FROM driver_profiles dp
    JOIN driver_locations dl ON dl.driver_id = dp.user_id
    LEFT JOIN driver_state ds ON ds.driver_id = dp.user_id
    WHERE dp.is_active = true
      AND dp.suspended_at IS NULL
      AND dl.updated_at > now() - INTERVAL '5 minutes'
      AND NOT (dp.user_id = ANY(_exclude_drivers))
      AND NOT EXISTS (
        SELECT 1 FROM pending_offers po
        WHERE po.driver_id = dp.user_id AND po.status = 'pending'
      )
  )
  SELECT
    dp.drv_id,
    ROUND(dp.dist_km, 2),
    dp.v_type,
    ROUND(
      dp.dist_km * COALESCE(s.dist_distance_weight, 0.3) * 10
      + (dp.active_cnt * 2.0)
      - (CASE WHEN dp.same_store THEN 5.0 ELSE 0 END)
      - (CASE WHEN dp.same_dropoff THEN 4.0 ELSE 0 END)
    , 3) AS score,
    dp.active_cnt,
    (dp.active_cnt > 0) AS is_stack
  FROM driver_pool dp
  WHERE dp.on_brk = false
    AND dp.dist_km <= COALESCE(s.dist_search_radius_km, 5)
    AND dp.active_cnt < max_stack
    -- Stack candidates: same store OR same-area delivery (same address / same route)
    AND (dp.active_cnt = 0 OR dp.same_store OR dp.same_dropoff)
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
$function$;