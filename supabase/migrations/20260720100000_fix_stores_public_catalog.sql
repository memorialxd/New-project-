-- Fix customer store catalog: stores_public was empty for anon/authenticated.
--
-- Root cause: migration 20260609051414 dropped policy "Anyone reads active stores"
-- while stores_public still used security_invoker=true, so the view inherited table RLS
-- and returned zero rows. Menu items remained visible (orphaned from the catalog).
--
-- Fix: rebuild stores_public as a security-definer-style view (security_invoker=false)
-- so public catalog reads use the view owner's rights, while base table RLS stays tight.
-- Sensitive columns stay excluded from the view (and remain revoked on public.stores).

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

COMMENT ON VIEW public.stores_public IS
  'Public store catalog. security_invoker=false so browsing works without a broad SELECT policy on stores.';
