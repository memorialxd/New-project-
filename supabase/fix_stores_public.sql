-- ONE-SHOT: run this in the Supabase SQL Editor if the customer app shows no restaurants.
-- Same fix as supabase/migrations/20260720100000_fix_stores_public_catalog.sql

DROP VIEW IF EXISTS public.stores_public;

CREATE VIEW public.stores_public
WITH (security_invoker = false) AS
SELECT
  id,
  owner_id,
  name,
  address,
  latitude,
  longitude,
  image_url,
  is_active,
  busy_mode,
  prep_buffer_minutes,
  opening_hours,
  holiday_dates,
  promotion_status,
  promotion_starts_at,
  promotion_ends_at,
  covers_delivery_fee,
  created_at,
  updated_at
FROM public.stores
WHERE COALESCE(is_active, false) = true
  AND suspended_at IS NULL;

GRANT SELECT ON public.stores_public TO anon, authenticated;
