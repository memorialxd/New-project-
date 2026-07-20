
-- 1. Fix order UPDATE policies: restrict financial field modifications

-- Drop existing broad policies
DROP POLICY IF EXISTS "Drivers can update assigned orders" ON public.orders;
DROP POLICY IF EXISTS "Store owners can update store orders" ON public.orders;

-- Recreate driver update policy: only allow status, photo_verification_url, pickup_checklist changes
CREATE POLICY "Drivers can update assigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id)
WITH CHECK (
  auth.uid() = driver_id
  AND total_amount IS NOT DISTINCT FROM (SELECT o.total_amount FROM public.orders o WHERE o.id = orders.id)
  AND delivery_fee IS NOT DISTINCT FROM (SELECT o.delivery_fee FROM public.orders o WHERE o.id = orders.id)
  AND tip_amount IS NOT DISTINCT FROM (SELECT o.tip_amount FROM public.orders o WHERE o.id = orders.id)
  AND customer_id IS NOT DISTINCT FROM (SELECT o.customer_id FROM public.orders o WHERE o.id = orders.id)
  AND store_id IS NOT DISTINCT FROM (SELECT o.store_id FROM public.orders o WHERE o.id = orders.id)
);

-- Recreate store owner update policy: prevent financial field tampering
CREATE POLICY "Store owners can update store orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM stores WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
))
WITH CHECK (
  total_amount IS NOT DISTINCT FROM (SELECT o.total_amount FROM public.orders o WHERE o.id = orders.id)
  AND delivery_fee IS NOT DISTINCT FROM (SELECT o.delivery_fee FROM public.orders o WHERE o.id = orders.id)
  AND tip_amount IS NOT DISTINCT FROM (SELECT o.tip_amount FROM public.orders o WHERE o.id = orders.id)
  AND customer_id IS NOT DISTINCT FROM (SELECT o.customer_id FROM public.orders o WHERE o.id = orders.id)
);

-- 2. Fix reviews: restrict to authenticated users only
DROP POLICY IF EXISTS "Reviews viewable by everyone" ON public.reviews;

CREATE POLICY "Authenticated users can view reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (true);

-- 3. Fix earnings: remove driver self-insert, add server-side function
DROP POLICY IF EXISTS "Drivers can insert own earnings" ON public.earnings;

-- Create a SECURITY DEFINER function for creating earnings (server-side only)
CREATE OR REPLACE FUNCTION public.create_driver_earning(
  p_driver_id uuid,
  p_order_id uuid,
  p_base_pay numeric,
  p_tip numeric DEFAULT 0,
  p_bonus numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  -- Verify the order exists and belongs to the driver and is delivered
  SELECT * INTO v_order FROM orders WHERE id = p_order_id AND driver_id = p_driver_id AND status = 'delivered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found, not assigned to driver, or not delivered';
  END IF;

  -- Check no duplicate earning for this order
  IF EXISTS (SELECT 1 FROM earnings WHERE order_id = p_order_id AND driver_id = p_driver_id) THEN
    RAISE EXCEPTION 'Earning already recorded for this order';
  END IF;

  INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus, total)
  VALUES (p_driver_id, p_order_id, p_base_pay, p_tip, p_bonus, p_base_pay + p_tip + p_bonus);
END;
$$;
