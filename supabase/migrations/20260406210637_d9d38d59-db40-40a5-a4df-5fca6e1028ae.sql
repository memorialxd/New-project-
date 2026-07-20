CREATE POLICY "Customers can view driver location for their orders"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.driver_id = driver_locations.driver_id
      AND o.customer_id = auth.uid()
      AND o.status IN ('accepted', 'preparing', 'ready', 'arrived', 'picked_up')
  )
);