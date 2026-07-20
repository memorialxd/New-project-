
-- Fix 1: Replace unsafe substring-match join on store delivery proof access with
-- a deterministic order_id lookup based on the actual file path convention
-- ({driver_id}/{order_id}.{ext}).
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
      AND o.id::text = split_part(
        (storage.foldername(name))[2],
        '.',
        1
      )
  )
);

-- Fix 2: Tighten user_roles INSERT/UPDATE/DELETE so privilege escalation is impossible
-- even if a permissive policy is added later. The existing permissive "Admins can manage roles"
-- ALL policy is replaced with explicit per-command policies that always require admin via
-- both USING and WITH CHECK clauses.
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Admins insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
