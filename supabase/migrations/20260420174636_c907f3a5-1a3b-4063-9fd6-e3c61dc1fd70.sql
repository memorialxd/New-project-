
-- 1) Fix request_wallet_withdrawal: enforce caller identity
CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_driver_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_driver_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT available_balance INTO v_balance FROM driver_wallets WHERE driver_id = p_driver_id;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  UPDATE driver_wallets
  SET available_balance = available_balance - p_amount,
      pending_balance = pending_balance + p_amount
  WHERE driver_id = p_driver_id;

  INSERT INTO wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id, 'withdrawal_request', p_amount, 'pending', 'Cash out request');
END;
$function$;

-- 2) Prevent profile role self-escalation
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change profile role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;
CREATE TRIGGER protect_profile_role_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

-- 3) Fix announcements RLS to use user_roles via has_role()
DROP POLICY IF EXISTS "Drivers can view their announcements" ON public.announcements;
DROP POLICY IF EXISTS "Store owners can view their announcements" ON public.announcements;

CREATE POLICY "Drivers can view their announcements"
ON public.announcements
FOR SELECT
USING (
  target_audience = ANY (ARRAY['drivers'::text, 'all'::text])
  AND public.has_role(auth.uid(), 'driver')
);

CREATE POLICY "Store owners can view their announcements"
ON public.announcements
FOR SELECT
USING (
  target_audience = ANY (ARRAY['store_owners'::text, 'all'::text])
  AND public.has_role(auth.uid(), 'store')
);

-- 4) Hide store suspension fields from public reads via a safe public view
DROP POLICY IF EXISTS "Stores are viewable by everyone" ON public.stores;

-- Authenticated users (admins, store owners) keep full access via existing policies
CREATE POLICY "Authenticated users can view stores"
ON public.stores
FOR SELECT
TO authenticated
USING (true);

-- Public-safe view (no suspension fields)
CREATE OR REPLACE VIEW public.stores_public
WITH (security_invoker = true) AS
SELECT id, name, address, latitude, longitude, phone, image_url,
       is_active, busy_mode, prep_buffer_minutes, created_at, updated_at, owner_id
FROM public.stores
WHERE is_active = true AND suspended_at IS NULL;

GRANT SELECT ON public.stores_public TO anon, authenticated;

-- 5) Restrict reviews visibility
DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;

CREATE POLICY "Customers can view own reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (auth.uid() = customer_id);

CREATE POLICY "Store owners can view reviews of their stores"
ON public.reviews
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.stores s
  WHERE s.id = reviews.store_id AND s.owner_id = auth.uid()
));

-- Public-facing aggregate view: ratings/comments without customer identity
CREATE OR REPLACE VIEW public.reviews_public
WITH (security_invoker = false) AS
SELECT id, store_id, rating, comment, created_at
FROM public.reviews;

GRANT SELECT ON public.reviews_public TO anon, authenticated;

-- 6) Lock down avatars bucket: prevent listing all files
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;

-- Allow direct file access (needed for <img src=...>) but block LIST operations
CREATE POLICY "Users can read their own avatar files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
