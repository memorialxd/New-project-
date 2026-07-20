CREATE TABLE IF NOT EXISTS public.dispatch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source text NOT NULL DEFAULT 'cron',
  success boolean NOT NULL DEFAULT false,
  dispatched integer NOT NULL DEFAULT 0,
  expired integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error text,
  details jsonb
);

CREATE INDEX IF NOT EXISTS idx_dispatch_runs_started_at ON public.dispatch_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_runs_success ON public.dispatch_runs (success, started_at DESC);

ALTER TABLE public.dispatch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read dispatch runs"
ON public.dispatch_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Retain only last 14 days
CREATE OR REPLACE FUNCTION public.cleanup_dispatch_runs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.dispatch_runs WHERE started_at < now() - interval '14 days';
$$;