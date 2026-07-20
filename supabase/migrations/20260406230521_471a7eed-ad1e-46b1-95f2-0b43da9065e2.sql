
-- 1. Fix driver_profiles INSERT: require driver role
DROP POLICY IF EXISTS "Drivers can insert own driver profile" ON public.driver_profiles;
CREATE POLICY "Drivers can insert own driver profile"
ON public.driver_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_role(auth.uid(), 'driver'::app_role));

-- 2. Fix orders: drivers must be active to claim
DROP POLICY IF EXISTS "Drivers can claim unassigned orders" ON public.orders;
CREATE POLICY "Drivers can claim unassigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  driver_id IS NULL
  AND public.has_role(auth.uid(), 'driver'::app_role)
)
WITH CHECK (
  driver_id = auth.uid()
  AND public.has_role(auth.uid(), 'driver'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.is_active = true
  )
);

-- 3. Fix orders: drivers can only update status and logistics fields, not financial
DROP POLICY IF EXISTS "Drivers can update assigned orders" ON public.orders;
CREATE POLICY "Drivers can update assigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id)
WITH CHECK (
  auth.uid() = driver_id
  AND NOT (total_amount IS DISTINCT FROM (SELECT o.total_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (delivery_fee IS DISTINCT FROM (SELECT o.delivery_fee FROM orders o WHERE o.id = orders.id))
  AND NOT (tip_amount IS DISTINCT FROM (SELECT o.tip_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (customer_id IS DISTINCT FROM (SELECT o.customer_id FROM orders o WHERE o.id = orders.id))
  AND NOT (store_id IS DISTINCT FROM (SELECT o.store_id FROM orders o WHERE o.id = orders.id))
);

-- 4. Fix orders: store owners can't modify financial fields
DROP POLICY IF EXISTS "Store owners can update store orders" ON public.orders;
CREATE POLICY "Store owners can update store orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
  )
)
WITH CHECK (
  NOT (total_amount IS DISTINCT FROM (SELECT o.total_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (delivery_fee IS DISTINCT FROM (SELECT o.delivery_fee FROM orders o WHERE o.id = orders.id))
  AND NOT (tip_amount IS DISTINCT FROM (SELECT o.tip_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (customer_id IS DISTINCT FROM (SELECT o.customer_id FROM orders o WHERE o.id = orders.id))
);

-- 5. Fix promo_codes: only show active codes publicly
DROP POLICY IF EXISTS "Anyone can view active promo codes" ON public.promo_codes;
CREATE POLICY "Anyone can view active promo codes"
ON public.promo_codes
FOR SELECT
USING (is_active = true);

-- 6. Fix reviews: restrict to authenticated users only
DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviews viewable by everyone" ON public.reviews;
CREATE POLICY "Authenticated users can view reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (true);
