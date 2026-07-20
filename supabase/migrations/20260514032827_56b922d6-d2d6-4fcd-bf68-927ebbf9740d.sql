CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-dispatch-every-30s') THEN
    PERFORM cron.unschedule('auto-dispatch-every-30s');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-dispatch-every-minute') THEN
    PERFORM cron.unschedule('auto-dispatch-every-minute');
  END IF;
END $$;