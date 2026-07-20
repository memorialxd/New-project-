CREATE OR REPLACE FUNCTION public.cleanup_stale_dispatch_artifacts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offers integer := 0;
  v_runs   integer := 0;
  v_events integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.pending_offers
       SET status = 'expired',
           responded_at = COALESCE(responded_at, now())
     WHERE status = 'pending'
       AND offered_at < now() - interval '10 minutes'
     RETURNING 1
  )
  SELECT count(*) INTO v_offers FROM expired;

  DELETE FROM public.pending_offers
   WHERE COALESCE(responded_at, offered_at, created_at) < now() - interval '10 minutes';

  WITH del AS (
    DELETE FROM public.dispatch_runs
     WHERE started_at < now() - interval '10 minutes'
     RETURNING 1
  )
  SELECT count(*) INTO v_runs FROM del;

  WITH del2 AS (
    DELETE FROM public.driver_offer_events
     WHERE created_at < now() - interval '1 day'
     RETURNING 1
  )
  SELECT count(*) INTO v_events FROM del2;

  RETURN jsonb_build_object(
    'expired_offers', v_offers,
    'pruned_runs',    v_runs,
    'pruned_events',  v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_dispatch_artifacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_dispatch_artifacts() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('prune-dispatch-runs-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-stale-dispatch-every-minute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-stale-dispatch-every-minute',
  '* * * * *',
  $$ SELECT public.cleanup_stale_dispatch_artifacts(); $$
);