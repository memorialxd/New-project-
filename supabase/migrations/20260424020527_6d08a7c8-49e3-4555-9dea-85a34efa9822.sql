
-- Add dispatch timing fields to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispatch_at timestamptz,
  ADD COLUMN IF NOT EXISTS predicted_prep_minutes integer;

CREATE INDEX IF NOT EXISTS idx_orders_dispatch_at ON public.orders(dispatch_at) WHERE dispatch_at IS NOT NULL;

-- Helper function: get historical avg prep time per store (last 30 delivered orders)
CREATE OR REPLACE FUNCTION public.get_store_avg_prep_minutes(p_store_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (
      (SELECT MIN(updated_at) FROM orders o2 WHERE o2.id = o.id AND o2.status = 'ready')
      - o.created_at
    )) / 60.0)::numeric,
    20
  )
  FROM (
    SELECT id, created_at, store_id, status
    FROM orders
    WHERE store_id = p_store_id
      AND status = 'delivered'
    ORDER BY created_at DESC
    LIMIT 30
  ) o;
$$;

-- Function to set dispatch timing — called from edge function via service role
CREATE OR REPLACE FUNCTION public.set_order_dispatch(
  p_order_id uuid,
  p_dispatch_at timestamptz,
  p_predicted_prep_minutes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE orders
  SET dispatch_at = p_dispatch_at,
      predicted_prep_minutes = p_predicted_prep_minutes
  WHERE id = p_order_id;
END;
$$;
