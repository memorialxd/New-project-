-- Fix storage policy that referenced the wrong column (store name instead of object path)
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;
CREATE POLICY "Store owners view their order proofs"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'order-proofs'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND (storage.foldername(storage.objects.name))[1] = (o.id)::text
  )
);

-- Pin search_path on remaining trigger function
ALTER FUNCTION public.guard_picked_up_requires_ready() SET search_path = public;