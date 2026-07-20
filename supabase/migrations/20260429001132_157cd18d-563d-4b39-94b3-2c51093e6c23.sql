
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_cash_cap numeric NOT NULL DEFAULT 200;

INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-proofs', 'delivery-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Drivers upload to their own folder: {driver_id}/{order_id}.jpg
CREATE POLICY "Drivers upload own delivery proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Drivers view own delivery proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Store owners view their order proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE s.owner_id = auth.uid()
        AND o.photo_verification_url LIKE '%' || name
    )
  );

CREATE POLICY "Support and admin view all delivery proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-proofs'
    AND public.is_support_or_admin(auth.uid())
  );
