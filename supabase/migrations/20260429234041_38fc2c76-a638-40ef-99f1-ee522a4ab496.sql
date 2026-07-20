
-- 1) store_pricing_overrides: restrict SELECT to admins + the relevant store owner
DROP POLICY IF EXISTS "Anyone authenticated can view overrides" ON public.store_pricing_overrides;

CREATE POLICY "Admins and store owners can view overrides"
ON public.store_pricing_overrides
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = store_pricing_overrides.store_id
      AND s.owner_id = auth.uid()
  )
);

-- 2) user_roles: explicit RESTRICTIVE policies blocking non-admin INSERT/UPDATE/DELETE
-- (Defence in depth on top of the existing PERMISSIVE "Admins can manage roles" policy.)
CREATE POLICY "Block non-admin role inserts"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block non-admin role updates"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block non-admin role deletes"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) order_item_modifiers: restrict to order participants
DROP POLICY IF EXISTS "Authed users view order item modifiers" ON public.order_item_modifiers;
DROP POLICY IF EXISTS "Authed users insert order item modifiers" ON public.order_item_modifiers;

CREATE POLICY "Order participants can view item modifiers"
ON public.order_item_modifiers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN public.stores s ON s.id = o.store_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
        OR public.is_support_or_admin(auth.uid())
      )
  )
);

CREATE POLICY "Order customer can insert item modifiers"
ON public.order_item_modifiers
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_modifiers.order_item_id
      AND (
        o.customer_id = auth.uid()
        OR public.is_support_or_admin(auth.uid())
      )
  )
);
