
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON public.announcements(expires_at);

CREATE POLICY "Support can view their announcements"
ON public.announcements
FOR SELECT
USING (
  target_audience = ANY (ARRAY['support'::text, 'all'::text])
  AND has_role(auth.uid(), 'support'::app_role)
);
