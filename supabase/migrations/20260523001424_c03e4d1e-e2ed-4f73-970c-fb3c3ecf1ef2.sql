
-- One-time cleanup: drop everything older than 3 days.
DELETE FROM public.dispatch_runs
WHERE started_at < now() - INTERVAL '3 days';

-- Reclaim space.
-- (VACUUM cannot run inside a migration transaction; skip and let autovacuum handle it.)

-- Scheduled daily prune so the table stays small.
CREATE OR REPLACE FUNCTION public.prune_dispatch_runs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.dispatch_runs
  WHERE started_at < now() - INTERVAL '3 days';
$$;

REVOKE ALL ON FUNCTION public.prune_dispatch_runs() FROM PUBLIC, anon, authenticated;

-- Replace any prior schedule so we don't double-schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('prune-dispatch-runs-daily');
EXCEPTION WHEN OTHERS THEN
  -- job didn't exist, ignore
  NULL;
END $$;

SELECT cron.schedule(
  'prune-dispatch-runs-daily',
  '17 3 * * *',  -- 03:17 UTC every day
  $$ SELECT public.prune_dispatch_runs(); $$
);
