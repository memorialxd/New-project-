
-- 1) orders: add batch_id and stop_sequence
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS stop_sequence integer;

CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON public.orders(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_driver_active ON public.orders(driver_id, status) WHERE driver_id IS NOT NULL;

-- 2) platform_settings: stacking knobs
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_stacked_orders integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS stack_max_detour_minutes integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS stacking_enabled boolean NOT NULL DEFAULT true;

-- 3) Rewrite nearby_active_drivers to support stack candidates.
-- A driver is eligible if their active-order count < max_stacked_orders.
-- If they have ANY active order, the candidate order's store must match one
-- of their active orders' stores (v1 same-store rule for "on the way").
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  _store_lat double precision,
  _store_lng double precision,
  _order_value numeric DEFAULT 0,
  _exclude_drivers uuid[] DEFAULT ARRAY[]::uuid[],
  _limit integer DEFAULT 10,
  _store_id uuid DEFAULT NULL
)
RETURNS TABLE(driver_id uuid, distance_km numeric, vehicle_type text, score numeric, active_orders integer, is_stack boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  max_stack INT;
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
      ) AS same_store
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
    -- Stack candidates: heavy bonus if same store (cheap to add), penalty per active load
    ROUND(
      dp.dist_km * COALESCE(s.dist_distance_weight, 0.3) * 10
      + (dp.active_cnt * 2.0)
      - (CASE WHEN dp.same_store THEN 5.0 ELSE 0 END)
    , 3) AS score,
    dp.active_cnt,
    (dp.active_cnt > 0) AS is_stack
  FROM driver_pool dp
  WHERE dp.on_brk = false
    AND dp.dist_km <= COALESCE(s.dist_search_radius_km, 5)
    AND dp.active_cnt < max_stack
    -- Stack candidates must already be heading to the same store (v1 rule)
    AND (dp.active_cnt = 0 OR dp.same_store)
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

GRANT EXECUTE ON FUNCTION public.nearby_active_drivers(
  double precision, double precision, numeric, uuid[], integer, uuid
) TO authenticated, service_role;

-- 4) Helper to compute the next stop sequence within a batch
CREATE OR REPLACE FUNCTION public.next_stop_sequence(_batch_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(MAX(stop_sequence), 0) + 1
  FROM public.orders
  WHERE batch_id = _batch_id;
$$;

GRANT EXECUTE ON FUNCTION public.next_stop_sequence(uuid) TO authenticated, service_role;
