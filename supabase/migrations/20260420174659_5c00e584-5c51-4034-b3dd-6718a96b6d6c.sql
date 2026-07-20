DROP POLICY IF EXISTS "Public can view review ratings" ON public.reviews;

-- Re-create reviews_public as a SECURITY DEFINER-style safe path
-- Use a function instead of a view to avoid RLS coupling
DROP VIEW IF EXISTS public.reviews_public;

CREATE OR REPLACE FUNCTION public.get_public_reviews(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  store_id uuid,
  rating integer,
  comment text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, store_id, rating, comment, created_at
  FROM public.reviews
  WHERE p_store_id IS NULL OR store_id = p_store_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_reviews(uuid) TO anon, authenticated;
