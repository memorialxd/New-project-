
-- 1. STORES: hide financial columns from non-admins
REVOKE SELECT (commission_pct, ext_commission_pct, ext_margin_pct,
               ext_flat_fee, suspension_reason, promotion_amount_paid)
  ON public.stores FROM anon, authenticated;

-- 2. COMMISSION_TIERS
DROP POLICY IF EXISTS "Admins and store owners read commission tiers" ON public.commission_tiers;
DROP POLICY IF EXISTS "Authenticated can read commission tiers" ON public.commission_tiers;
CREATE POLICY "Admins read commission tiers"
ON public.commission_tiers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. STORE_PRICING_OVERRIDES
DROP POLICY IF EXISTS "Admins and store owners can view overrides" ON public.store_pricing_overrides;
CREATE POLICY "Admins view pricing overrides"
ON public.store_pricing_overrides FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. GROUP_ORDERS
DROP POLICY IF EXISTS "Anyone authed can view by share code" ON public.group_orders;
CREATE POLICY "Host, participants and staff view group orders"
ON public.group_orders FOR SELECT TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_order_participants p
    WHERE p.group_order_id = group_orders.id AND p.user_id = auth.uid()
  )
  OR public.is_support_or_admin(auth.uid())
);

-- 5. GROUP_ORDER_PARTICIPANTS
DROP POLICY IF EXISTS "Authed users can view participants" ON public.group_order_participants;
CREATE POLICY "Group members and staff view participants"
ON public.group_order_participants FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_orders g
    WHERE g.id = group_order_participants.group_order_id
      AND (g.host_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.group_order_participants p2
             WHERE p2.group_order_id = g.id AND p2.user_id = auth.uid()
           ))
  )
  OR public.is_support_or_admin(auth.uid())
);

-- 6. STORAGE: fix broken store-owner order-proof policy
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;
CREATE POLICY "Store owners view their order proofs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'order-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND (storage.foldername(name))[1] = o.id::text
  )
);
