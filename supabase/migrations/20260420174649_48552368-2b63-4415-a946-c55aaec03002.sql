DROP VIEW IF EXISTS public.reviews_public;

CREATE VIEW public.reviews_public
WITH (security_invoker = true) AS
SELECT id, store_id, rating, comment, created_at
FROM public.reviews;

GRANT SELECT ON public.reviews_public TO anon, authenticated;

-- Allow public read of rating/comment data through the view
CREATE POLICY "Public can view review ratings"
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (true);
