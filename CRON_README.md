# Cron secret & leaked JWT remediation

I found an embedded project JWT in the repository's SQL cron schedule which is a security risk.
This commit adds a sanitized SQL script (supabase/cron_sanitize.sql) that unschedules the old
cron jobs and reschedules them without embedding the Authorization header value.

What I changed
- Added supabase/cron_sanitize.sql with unschedule + reschedule statements that do NOT
  contain any project JWTs.
- Added instructions to rotate leaked tokens and prefer x-cron-secret or server-side injection.

What you must do next (manual steps)
1) Rotate the leaked JWT/API key in your Supabase project immediately — treat it as compromised.
2) Run the SQL in supabase/cron_sanitize.sql against your Postgres instance (pg_cron environment).
   Example: connect with psql or use the Supabase SQL editor and run the script.
3) Configure the cron caller to send a secure header (x-cron-secret) or use a protected
   server-side proxy which injects the Authorization header from an environment variable.
4) Verify the auto-dispatch function still receives requests and logs runs in dispatch_runs.

If you want, I can also:
- Remove the JWT from the original batch_12.sql and commit the sanitized version in its place.
- Implement an atomic DB claim RPC and update the auto-dispatch function to call it (recommended
  to avoid race conditions). This requires a follow-up patch.

