
-- Drop 4 of the 6 staggered dispatch jobs; keep 2 (0s and 30s offset).
SELECT cron.unschedule('auto-dispatch-10s-10');
SELECT cron.unschedule('auto-dispatch-10s-20');
SELECT cron.unschedule('auto-dispatch-10s-40');
SELECT cron.unschedule('auto-dispatch-10s-50');

-- Rebuild remaining two to fire once at :00 and once at :30 (instead of every 10s).
SELECT cron.unschedule('auto-dispatch-10s-0');
SELECT cron.unschedule('auto-dispatch-10s-30');

SELECT cron.schedule(
  'auto-dispatch-30s-0',
  '* * * * *',
  $$SELECT net.http_post(
      url:='https://<YOUR_PROJECT>.supabase.co/functions/v1/auto-dispatch',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_ANON_OR_SERVICE_JWT>"}'::jsonb,
      body:='{"source":"cron"}'::jsonb
   ) AS request_id;$$
);

SELECT cron.schedule(
  'auto-dispatch-30s-30',
  '* * * * *',
  $$SELECT pg_sleep(30); SELECT net.http_post(
      url:='https://<YOUR_PROJECT>.supabase.co/functions/v1/auto-dispatch',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_ANON_OR_SERVICE_JWT>"}'::jsonb,
      body:='{"source":"cron"}'::jsonb
   ) AS request_id;$$
);
