
-- 1. Restrict platform_settings SELECT to admin/support; expose safe fields via view
DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Authenticated read platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Anyone authed view platform settings" ON public.platform_settings;

CREATE POLICY "Admins and support read platform settings"
ON public.platform_settings
FOR SELECT
TO authenticated
USING (public.is_support_or_admin(auth.uid()));

-- Public-safe view (only fields needed by non-admin clients)
CREATE OR REPLACE VIEW public.platform_settings_public
WITH (security_invoker = true) AS
SELECT
  id,
  platform_service_fee,
  max_cash_cap,
  show_stores_on_driver_map,
  assignment_mode,
  maintenance_mode,
  maintenance_message,
  customer_base_fee,
  customer_per_km_fee
FROM public.platform_settings;

-- The view runs as invoker, so we need a permissive SELECT policy on the
-- underlying table only for these columns. Simpler: bypass via SECURITY DEFINER
-- function that returns a single row.
CREATE OR REPLACE FUNCTION public.get_platform_settings_public()
RETURNS TABLE (
  platform_service_fee numeric,
  max_cash_cap numeric,
  show_stores_on_driver_map boolean,
  assignment_mode text,
  maintenance_mode boolean,
  maintenance_message text,
  customer_base_fee numeric,
  customer_per_km_fee numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    platform_service_fee,
    max_cash_cap,
    show_stores_on_driver_map,
    assignment_mode,
    maintenance_mode,
    maintenance_message,
    customer_base_fee,
    customer_per_km_fee
  FROM public.platform_settings
  WHERE id = 1
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_settings_public() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_settings_public() TO authenticated;

-- 2. Restrict commission_tiers SELECT to admins + store owners
DROP POLICY IF EXISTS "Authenticated read commission tiers" ON public.commission_tiers;

CREATE POLICY "Admins and store owners read commission tiers"
ON public.commission_tiers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'store'::app_role)
);

-- 3. Fix delivery-proofs storage policy
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;

CREATE POLICY "Store owners view their order proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND o.id::text = (storage.foldername(name))[1]
  )
);

-- 4. Realtime: require authentication for Broadcast/Presence on realtime.messages
DO $$
BEGIN
  EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
EXCEPTION WHEN others THEN NULL;
END$$;

DROP POLICY IF EXISTS "Authenticated can read realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can write realtime messages" ON realtime.messages;

CREATE POLICY "Authenticated can read realtime messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated can write realtime messages"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (true);
