
-- Drop the trigger first, then the function
DROP TRIGGER IF EXISTS trigger_assign_random_driver ON public.orders;
DROP FUNCTION IF EXISTS public.assign_random_driver();

-- Allow drivers to SELECT unassigned orders (offers)
CREATE POLICY "Drivers can view unassigned orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  driver_id IS NULL
  AND status IN ('placed', 'accepted', 'preparing', 'ready')
  AND has_role(auth.uid(), 'driver')
);

-- Allow drivers to UPDATE unassigned orders to claim them
CREATE POLICY "Drivers can claim unassigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  driver_id IS NULL
  AND has_role(auth.uid(), 'driver')
)
WITH CHECK (
  driver_id = auth.uid()
  AND has_role(auth.uid(), 'driver')
);
