
-- Helper: does this user have an active order at this store (as driver)?
CREATE OR REPLACE FUNCTION public.driver_has_active_order_at_store(_user uuid, _store uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = _store
      AND o.driver_id = _user
      AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
  );
$$;

-- Helper: does this user have any order at this store (as customer)?
CREATE OR REPLACE FUNCTION public.customer_has_order_at_store(_user uuid, _store uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = _store AND o.customer_id = _user
  );
$$;

REVOKE EXECUTE ON FUNCTION public.driver_has_active_order_at_store(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_has_order_at_store(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_has_active_order_at_store(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_has_order_at_store(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Drivers view stores for their active orders" ON public.stores;
DROP POLICY IF EXISTS "Customers view stores for their active orders" ON public.stores;

CREATE POLICY "Drivers view stores for their active orders" ON public.stores
  FOR SELECT USING (public.driver_has_active_order_at_store(auth.uid(), id));

CREATE POLICY "Customers view stores for their active orders" ON public.stores
  FOR SELECT USING (public.customer_has_order_at_store(auth.uid(), id));
