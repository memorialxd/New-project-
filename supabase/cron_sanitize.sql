-- Sanitize cron schedules to remove embedded project JWTs and replace with safer header usage.
-- Run this SQL in your Postgres (supabase) database to unschedule the old cron jobs and reschedule them
-- WITHOUT embedding the project's JWT in the SQL. After running, rotate the leaked JWT in Supabase.

-- Unschedule known 10s/30s jobs (if present)
SELECT cron.unschedule('auto-dispatch-10s-10') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-10s-20') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-10s-40') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-10s-50') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-10s-0') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-10s-30') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-30s-0') ON CONFLICT DO NOTHING;
SELECT cron.unschedule('auto-dispatch-30s-30') ON CONFLICT DO NOTHING;

-- Reschedule two safe cron jobs that call the auto-dispatch function.
-- IMPORTANT: these schedules intentionally do NOT include the Authorization header.
-- Instead, configure your pg_cron environment or an HTTP proxy to inject a secret
-- header (x-cron-secret) or use the project's server-side mechanism for cron auth.

SELECT cron.schedule(
  'auto-dispatch-30s-0',
  '* * * * *',
  $$SELECT net.http_post(
      url:='https://<YOUR_PROJECT>.supabase.co/functions/v1/auto-dispatch',
      headers:='{"Content-Type":"application/json"}'::jsonb,
      body:='{"source":"cron"}'::jsonb
   ) AS request_id;$$
);

SELECT cron.schedule(
  'auto-dispatch-30s-30',
  '* * * * *',
  $$SELECT pg_sleep(30); SELECT net.http_post(
      url:='https://<YOUR_PROJECT>.supabase.co/functions/v1/auto-dispatch',
      headers:='{"Content-Type":"application/json"}'::jsonb,
      body:='{"source":"cron"}'::jsonb
   ) AS request_id;$$
);

-- NOTES:
-- 1) After running this, rotate the leaked project anonymous JWT immediately in Supabase.
-- 2) Consider configuring pg_cron or a small server-side proxy that injects an x-cron-secret
--    header (or uses the Supabase service key from a protected environment) instead of
--    embedding any secret in repository SQL files.
-- 3) If your environment requires a header for auth, configure the cron caller to send
--    the x-cron-secret header and ensure the function checks hasCronSecret(req) (already
--    implemented in the function code).
