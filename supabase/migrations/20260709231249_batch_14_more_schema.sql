-- Source: 20260609051414_e36eb90e-db99-4a4b-8ac5-23c10d8f4625.sql
-- 1. Drop overly broad public stores SELECT policy. Customer-facing browsing uses stores_public view.
DROP POLICY IF EXISTS "Anyone reads active stores" ON public.stores;

-- 2. Tighten customer_has_order_at_store: only count orders in active/recent statuses
CREATE OR REPLACE FUNCTION public.customer_has_order_at_store(_user uuid, _store uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = _store
      AND o.customer_id = _user
      AND o.status IN ('placed','accepted','preparing','ready','arrived','picked_up','delivered')
      AND o.created_at > now() - interval '30 days'
  );
$$;

-- 3. Fix delivery-proofs store-owner SELECT policy (path is {driver_id}/{order_id}.{ext})
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;
DO $$ BEGIN
CREATE POLICY "Store owners view their order proofs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND o.driver_id::text = (storage.foldername(storage.objects.name))[1]
      AND split_part(storage.filename(storage.objects.name), '.', 1) = o.id::text
  )
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Lock down wait_time_bonuses: server recomputes bonus_amount/wait_minutes/is_applied on UPDATE
CREATE OR REPLACE FUNCTION public.enforce_wait_bonus_server_calc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  arrived timestamptz;
  picked timestamptz;
  computed_minutes int;
  computed_bonus numeric := 0;
  rate_per_min numeric := 0;
  grace_minutes int := 5;
  cap_amount numeric := 5;
BEGIN
  -- Admins bypass (their own ALL policy already lets them set values)
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Pull canonical timestamps from the order
  SELECT NULL::timestamptz, NULL::timestamptz INTO arrived, picked;
  -- orders table doesn't have explicit arrived_at/picked_up_at columns; use status timestamps if present.
  -- Fallback: use NEW.arrived_at and NEW.picked_up_at (drivers can set those via app flow).
  arrived := NEW.arrived_at;
  picked  := NEW.picked_up_at;

  -- Pull policy values from platform_settings if columns exist (best-effort)
  BEGIN
    EXECUTE 'SELECT COALESCE(wait_bonus_rate_per_min, 0), COALESCE(wait_bonus_grace_minutes, 5), COALESCE(wait_bonus_cap, 5) FROM public.platform_settings WHERE id = 1'
      INTO rate_per_min, grace_minutes, cap_amount;
  EXCEPTION WHEN undefined_column THEN
    rate_per_min := 0.20;
    grace_minutes := 5;
    cap_amount := 5;
  END;

  IF picked IS NULL OR arrived IS NULL THEN
    NEW.wait_minutes := 0;
    NEW.bonus_amount := 0;
    NEW.is_applied := false;
  ELSE
    computed_minutes := GREATEST(0, EXTRACT(EPOCH FROM (picked - arrived))/60)::int;
    NEW.wait_minutes := computed_minutes;
    computed_bonus := GREATEST(0, computed_minutes - grace_minutes) * rate_per_min;
    IF computed_bonus > cap_amount THEN computed_bonus := cap_amount; END IF;
    NEW.bonus_amount := ROUND(computed_bonus, 2);
    NEW.is_applied := (NEW.bonus_amount > 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_wait_bonus_server_calc ON public.wait_time_bonuses;
CREATE TRIGGER trg_enforce_wait_bonus_server_calc
BEFORE INSERT OR UPDATE ON public.wait_time_bonuses
FOR EACH ROW EXECUTE FUNCTION public.enforce_wait_bonus_server_calc();

-- Source: 20260609052130_daf789c8-b6a3-4c99-b3db-4156cb72ac0a.sql
-- Suspend a driver
CREATE OR REPLACE FUNCTION public.admin_suspend_driver(p_driver_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.driver_profiles
    SET suspended_at = now(),
        suspension_reason = COALESCE(p_reason, suspension_reason),
        is_active = false,
        updated_at = now()
    WHERE user_id = p_driver_id;

  UPDATE public.driver_state
    SET shift_started_at = NULL,
        on_break = false,
        break_started_at = NULL,
        updated_at = now()
    WHERE driver_id = p_driver_id;
END;
$$;

-- Unsuspend
CREATE OR REPLACE FUNCTION public.admin_unsuspend_driver(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.driver_profiles
    SET suspended_at = NULL,
        suspension_reason = NULL,
        is_active = true,
        updated_at = now()
    WHERE user_id = p_driver_id;
END;
$$;

-- Adjust driver wallet by signed amount
CREATE OR REPLACE FUNCTION public.admin_adjust_driver_wallet(p_driver_id uuid, p_amount numeric, p_note text DEFAULT 'Admin adjustment')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_bal numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'Amount required'; END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
  VALUES (p_driver_id, GREATEST(p_amount, 0), 0, 0)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = GREATEST(public.driver_wallets.available_balance + p_amount, 0),
        updated_at = now()
  RETURNING available_balance INTO new_bal;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id, CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END,
          p_amount, 'completed', COALESCE(p_note, 'Admin adjustment'));

  RETURN new_bal;
END;
$$;

-- Clear all unresolved cash debts
CREATE OR REPLACE FUNCTION public.admin_clear_driver_cash_debt(p_driver_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleared int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.driver_cash_debts
    SET settled = true,
        settled_at = now(),
        settled_by = auth.uid()
    WHERE driver_id = p_driver_id AND settled = false;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END;
$$;

-- Send a direct message to a driver
CREATE OR REPLACE FUNCTION public.admin_send_driver_message(p_driver_id uuid, p_title text, p_body text, p_severity text DEFAULT 'info')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  INSERT INTO public.driver_notifications (driver_id, title, body, severity, sender_id)
  VALUES (p_driver_id, COALESCE(p_title,'Μήνυμα'), COALESCE(p_body,''), COALESCE(p_severity,'info'), auth.uid())
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Force order status (admin god-mode)
CREATE OR REPLACE FUNCTION public.admin_force_order_status(p_order_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.orders SET status = p_status::order_status, updated_at = now() WHERE id = p_order_id;
END;
$$;

-- Partial / full refund
CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_amount numeric, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  UPDATE public.orders
    SET refunded_amount = COALESCE(refunded_amount,0) + p_amount,
        refund_reason = COALESCE(p_reason, refund_reason),
        updated_at = now()
    WHERE id = p_order_id;

  -- Credit customer wallet
  IF o.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_wallets (customer_id, balance, lifetime_credit)
    VALUES (o.customer_id, p_amount, p_amount)
    ON CONFLICT (customer_id) DO UPDATE
      SET balance = public.customer_wallets.balance + p_amount,
          lifetime_credit = public.customer_wallets.lifetime_credit + p_amount,
          updated_at = now();

    INSERT INTO public.customer_wallet_ledger (customer_id, amount, type, description, order_id)
    VALUES (o.customer_id, p_amount, 'refund', COALESCE(p_reason,'Refund'), p_order_id);
  END IF;

  INSERT INTO public.refunds (order_id, amount, reason, status, processed_by, processed_at)
  VALUES (p_order_id, p_amount, p_reason, 'completed', auth.uid(), now());
END;
$$;

-- Source: 20260612193132_email_infra.sql
-- Email infrastructure
-- Creates the queue system, send log, send state, suppression, and unsubscribe
-- tables used by both auth and transactional emails.

-- Extensions required for queue processing
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create email queues (auth = high priority, transactional = normal)
-- Wrapped in DO blocks to handle "queue already exists" errors idempotently.
DO $$ BEGIN PERFORM pgmq.create('auth_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Dead-letter queues for messages that exceed max retries
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Email send log table (audit trail for all send attempts)
-- UPDATE is allowed for the service role so the suppression edge function
-- can update a log record's status when a bounce/complaint/unsubscribe occurs.
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  template_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supabase no longer grants public-schema access to service_role by default;
-- emit the grant explicitly so edge functions can reach the table via PostgREST.
GRANT ALL ON public.email_send_log TO service_role;

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can read send log" ON public.email_send_log;
  CREATE POLICY "Service role can read send log"
    ON public.email_send_log FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log;
  CREATE POLICY "Service role can insert send log"
    ON public.email_send_log FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log;
  CREATE POLICY "Service role can update send log"
    ON public.email_send_log FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_created ON public.email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient ON public.email_send_log(recipient_email);

-- Backfill: add message_id column to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_log ADD COLUMN message_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_message ON public.email_send_log(message_id);

-- Prevent duplicate sends: only one 'sent' row per message_id.
-- If VT expires and another worker picks up the same message, the pre-send
-- check catches it. This index is a DB-level safety net for race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_message_sent_unique
  ON public.email_send_log(message_id) WHERE status = 'sent';

-- Backfill: update status CHECK constraint for existing tables that predate new statuses
DO $$ BEGIN
  ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq'));
END $$;

-- Rate-limit state and queue config (single row, tracks Retry-After cooldown + throughput settings)
CREATE TABLE IF NOT EXISTS public.email_send_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retry_after_until TIMESTAMPTZ,
  batch_size INTEGER NOT NULL DEFAULT 10,
  send_delay_ms INTEGER NOT NULL DEFAULT 200,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Backfill: add config columns to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 10;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN send_delay_ms INTEGER NOT NULL DEFAULT 200;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

GRANT ALL ON public.email_send_state TO service_role;

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state;
  CREATE POLICY "Service role can manage send state"
    ON public.email_send_state FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RPC wrappers so Edge Functions can interact with pgmq via supabase.rpc()
-- (PostgREST only exposes functions in the public schema; pgmq functions are in the pgmq schema)
-- All wrappers auto-create the queue on undefined_table (42P01) so emails
-- are never lost if the queue was dropped (extension upgrade, restore, etc.).
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;

-- Restrict queue RPC wrappers to service_role only (SECURITY DEFINER runs as owner,
-- so without this any authenticated user could manipulate the email queues)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- Suppressed emails table (tracks unsubscribes, bounces, complaints)
-- Append-only: no DELETE or UPDATE policies to prevent bypassing suppression.
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email)
);

GRANT ALL ON public.suppressed_emails TO service_role;

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails;
  CREATE POLICY "Service role can read suppressed emails"
    ON public.suppressed_emails FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
  CREATE POLICY "Service role can insert suppressed emails"
    ON public.suppressed_emails FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON public.suppressed_emails(email);

-- Email unsubscribe tokens table (one token per email address for unsubscribe links)
-- No DELETE policy to prevent removing tokens. UPDATE allowed only to mark tokens as used.
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

GRANT ALL ON public.email_unsubscribe_tokens TO service_role;

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens;
  CREATE POLICY "Service role can read tokens"
    ON public.email_unsubscribe_tokens FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens;
  CREATE POLICY "Service role can insert tokens"
    ON public.email_unsubscribe_tokens FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
  CREATE POLICY "Service role can mark tokens as used"
    ON public.email_unsubscribe_tokens FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

-- ============================================================
-- POST-MIGRATION STEPS (applied dynamically by setup_email_infra)
-- These steps contain project-specific secrets and URLs and
-- cannot be expressed as static SQL. They are applied via the
-- Supabase Management API (ExecuteSQL) each time the tool runs.
-- ============================================================
--
-- 1. VAULT SECRET
--    Stores (or updates) the Supabase service_role key in
--    vault as 'email_queue_service_role_key'.
--    Uses vault.create_secret / vault.update_secret (upsert).
--    To revert: DELETE FROM vault.secrets WHERE name = 'email_queue_service_role_key';
--
-- 2. CRON JOB (pg_cron)
--    Creates job 'process-email-queue' with a 5-second interval.
--    The job checks:
--      a) rate-limit cooldown (email_send_state.retry_after_until)
--      b) whether auth_emails or transactional_emails queues have messages
--    If conditions are met, it calls the process-email-queue Edge Function
--    via net.http_post using the vault-stored service_role key.
--    To revert: SELECT cron.unschedule('process-email-queue');


-- Source: 20260621203245_a87d5e52-239a-48c4-b6ed-402c4d8e731d.sql
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_issued_by_month
  ON public.wallet_transactions (issued_by, created_at)
  WHERE type IN ('support_credit','admin_credit');

CREATE OR REPLACE FUNCTION public.support_credit_wallet(
  p_driver_id uuid, p_amount numeric, p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_is_support boolean := public.has_role(auth.uid(), 'support');
  v_max numeric;
  v_monthly_limit int;
  v_used int;
BEGIN
  IF NOT (v_is_admin OR v_is_support) THEN
    RAISE EXCEPTION 'Forbidden: only support or admin may credit wallets';
  END IF;

  v_max           := CASE WHEN v_is_admin THEN 20 ELSE 5 END;
  v_monthly_limit := CASE WHEN v_is_admin THEN 30 ELSE 5 END;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_max THEN
    RAISE EXCEPTION 'Amount must be between 0 and % EUR for your role', v_max;
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT count(*) INTO v_used
    FROM public.wallet_transactions
   WHERE issued_by = auth.uid()
     AND type IN ('support_credit','admin_credit')
     AND created_at >= date_trunc('month', now());

  IF v_used >= v_monthly_limit THEN
    RAISE EXCEPTION 'Monthly credit limit reached (%/%) for this month', v_used, v_monthly_limit;
  END IF;

  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
    ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET available_balance = available_balance + p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

  INSERT INTO public.wallet_transactions
    (driver_id, type, amount, status, description, issued_by)
  VALUES
    (p_driver_id,
     CASE WHEN v_is_admin THEN 'admin_credit' ELSE 'support_credit' END,
     p_amount, 'completed', p_reason, auth.uid());
END;
$$;

-- Source: 20260622081047_060975a0-aad9-4c8a-9f4b-7eca48688a05.sql

-- 1) orders: add batch_id and stop_sequence
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS stop_sequence integer;

CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON public.orders(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_driver_active ON public.orders(driver_id, status) WHERE driver_id IS NOT NULL;

-- 2) platform_settings: stacking knobs
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_stacked_orders integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS stack_max_detour_minutes integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS stacking_enabled boolean NOT NULL DEFAULT true;

-- 3) Rewrite nearby_active_drivers to support stack candidates.
-- A driver is eligible if their active-order count < max_stacked_orders.
-- If they have ANY active order, the candidate order's store must match one
-- of their active orders' stores (v1 same-store rule for "on the way").
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  _store_lat double precision,
  _store_lng double precision,
  _order_value numeric DEFAULT 0,
  _exclude_drivers uuid[] DEFAULT ARRAY[]::uuid[],
  _limit integer DEFAULT 10,
  _store_id uuid DEFAULT NULL
)
RETURNS TABLE(driver_id uuid, distance_km numeric, vehicle_type text, score numeric, active_orders integer, is_stack boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  max_stack INT;
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;
  max_stack := GREATEST(1, COALESCE(s.max_stacked_orders, 1));

  RETURN QUERY
  WITH driver_pool AS (
    SELECT
      dp.user_id AS drv_id,
      COALESCE(dp.vehicle_type, 'motorcycle') AS v_type,
      dl.latitude AS lat,
      dl.longitude AS lng,
      (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_store_lat)) * cos(radians(dl.latitude)) *
          cos(radians(dl.longitude) - radians(_store_lng)) +
          sin(radians(_store_lat)) * sin(radians(dl.latitude))
        ))
      ))::NUMERIC AS dist_km,
      COALESCE(ds.on_break, false) AS on_brk,
      (
        SELECT COUNT(*)::INT FROM orders o
        WHERE o.driver_id = dp.user_id
          AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
      ) AS active_cnt,
      (
        _store_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.driver_id = dp.user_id
            AND o.status IN ('accepted','preparing','ready','arrived')
            AND o.store_id = _store_id
        )
      ) AS same_store
    FROM driver_profiles dp
    JOIN driver_locations dl ON dl.driver_id = dp.user_id
    LEFT JOIN driver_state ds ON ds.driver_id = dp.user_id
    WHERE dp.is_active = true
      AND dp.suspended_at IS NULL
      AND dl.updated_at > now() - INTERVAL '5 minutes'
      AND NOT (dp.user_id = ANY(_exclude_drivers))
      AND NOT EXISTS (
        SELECT 1 FROM pending_offers po
        WHERE po.driver_id = dp.user_id AND po.status = 'pending'
      )
  )
  SELECT
    dp.drv_id,
    ROUND(dp.dist_km, 2),
    dp.v_type,
    -- Stack candidates: heavy bonus if same store (cheap to add), penalty per active load
    ROUND(
      dp.dist_km * COALESCE(s.dist_distance_weight, 0.3) * 10
      + (dp.active_cnt * 2.0)
      - (CASE WHEN dp.same_store THEN 5.0 ELSE 0 END)
    , 3) AS score,
    dp.active_cnt,
    (dp.active_cnt > 0) AS is_stack
  FROM driver_pool dp
  WHERE dp.on_brk = false
    AND dp.dist_km <= COALESCE(s.dist_search_radius_km, 5)
    AND dp.active_cnt < max_stack
    -- Stack candidates must already be heading to the same store (v1 rule)
    AND (dp.active_cnt = 0 OR dp.same_store)
    AND (
      NOT COALESCE(s.dist_vehicle_rules_enabled, false)
      OR (
        (dp.v_type = 'bike' AND dp.dist_km <= COALESCE(s.dist_bike_max_km, 3))
        OR (dp.v_type = 'motorcycle' AND dp.dist_km <= COALESCE(s.dist_motorcycle_max_km, 8))
        OR (dp.v_type = 'car' AND _order_value >= COALESCE(s.dist_car_min_value, 25))
        OR dp.v_type NOT IN ('bike','motorcycle','car')
      )
    )
  ORDER BY score ASC, dp.dist_km ASC
  LIMIT _limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.nearby_active_drivers(
  double precision, double precision, numeric, uuid[], integer, uuid
) TO authenticated, service_role;

-- 4) Helper to compute the next stop sequence within a batch
CREATE OR REPLACE FUNCTION public.next_stop_sequence(_batch_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(MAX(stop_sequence), 0) + 1
  FROM public.orders
  WHERE batch_id = _batch_id;
$$;

GRANT EXECUTE ON FUNCTION public.next_stop_sequence(uuid) TO authenticated, service_role;


-- Source: 20260622081304_16ce0c59-0aab-4bbe-9fa9-90eba6666da7.sql

DROP FUNCTION IF EXISTS public.get_platform_settings_public();

CREATE OR REPLACE FUNCTION public.get_platform_settings_public()
RETURNS TABLE(
  platform_service_fee numeric,
  max_cash_cap numeric,
  show_stores_on_driver_map boolean,
  assignment_mode text,
  maintenance_mode boolean,
  maintenance_message text,
  customer_base_fee numeric,
  customer_per_km_fee numeric,
  max_stacked_orders integer,
  stacking_enabled boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    platform_service_fee,
    max_cash_cap,
    show_stores_on_driver_map,
    assignment_mode,
    maintenance_mode,
    maintenance_message,
    customer_base_fee,
    customer_per_km_fee,
    max_stacked_orders,
    stacking_enabled
  FROM public.platform_settings
  WHERE id = 1
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_platform_settings_public() TO anon, authenticated, service_role;


-- Source: 20260623064659_9b8767d5-1ca8-4337-9947-b23f7f1b7c46.sql
CREATE OR REPLACE FUNCTION public.validate_distribution_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.distribution_mode NOT IN ('nearest','broadcast','batched','smart','fair_earnings') THEN
    RAISE EXCEPTION 'Invalid distribution_mode: %', NEW.distribution_mode;
  END IF;
  RETURN NEW;
END;
$$;

-- Source: 20260623065349_da3ff97d-49a6-42a5-a5e8-2c5117c81198.sql
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  _store_lat double precision,
  _store_lng double precision,
  _order_value numeric DEFAULT 0,
  _exclude_drivers uuid[] DEFAULT ARRAY[]::uuid[],
  _limit integer DEFAULT 10,
  _store_id uuid DEFAULT NULL::uuid,
  _dropoff_lat double precision DEFAULT NULL,
  _dropoff_lng double precision DEFAULT NULL
)
RETURNS TABLE(driver_id uuid, distance_km numeric, vehicle_type text, score numeric, active_orders integer, is_stack boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  max_stack INT;
  near_km NUMERIC := 0.6; -- ~600m considered "same route / same address"
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;
  max_stack := GREATEST(1, COALESCE(s.max_stacked_orders, 1));

  RETURN QUERY
  WITH driver_pool AS (
    SELECT
      dp.user_id AS drv_id,
      COALESCE(dp.vehicle_type, 'motorcycle') AS v_type,
      dl.latitude AS lat,
      dl.longitude AS lng,
      (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_store_lat)) * cos(radians(dl.latitude)) *
          cos(radians(dl.longitude) - radians(_store_lng)) +
          sin(radians(_store_lat)) * sin(radians(dl.latitude))
        ))
      ))::NUMERIC AS dist_km,
      COALESCE(ds.on_break, false) AS on_brk,
      (
        SELECT COUNT(*)::INT FROM orders o
        WHERE o.driver_id = dp.user_id
          AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
      ) AS active_cnt,
      (
        _store_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.driver_id = dp.user_id
            AND o.status IN ('accepted','preparing','ready','arrived')
            AND o.store_id = _store_id
        )
      ) AS same_store,
      (
        _dropoff_lat IS NOT NULL AND _dropoff_lng IS NOT NULL AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.driver_id = dp.user_id
            AND o.status IN ('accepted','preparing','ready','arrived','picked_up')
            AND o.delivery_latitude IS NOT NULL
            AND o.delivery_longitude IS NOT NULL
            AND (6371 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians(_dropoff_lat)) * cos(radians(o.delivery_latitude)) *
                cos(radians(o.delivery_longitude) - radians(_dropoff_lng)) +
                sin(radians(_dropoff_lat)) * sin(radians(o.delivery_latitude))
              ))
            )) <= near_km
        )
      ) AS same_dropoff
    FROM driver_profiles dp
    JOIN driver_locations dl ON dl.driver_id = dp.user_id
    LEFT JOIN driver_state ds ON ds.driver_id = dp.user_id
    WHERE dp.is_active = true
      AND dp.suspended_at IS NULL
      AND dl.updated_at > now() - INTERVAL '5 minutes'
      AND NOT (dp.user_id = ANY(_exclude_drivers))
      AND NOT EXISTS (
        SELECT 1 FROM pending_offers po
        WHERE po.driver_id = dp.user_id AND po.status = 'pending'
      )
  )
  SELECT
    dp.drv_id,
    ROUND(dp.dist_km, 2),
    dp.v_type,
    ROUND(
      dp.dist_km * COALESCE(s.dist_distance_weight, 0.3) * 10
      + (dp.active_cnt * 2.0)
      - (CASE WHEN dp.same_store THEN 5.0 ELSE 0 END)
      - (CASE WHEN dp.same_dropoff THEN 4.0 ELSE 0 END)
    , 3) AS score,
    dp.active_cnt,
    (dp.active_cnt > 0) AS is_stack
  FROM driver_pool dp
  WHERE dp.on_brk = false
    AND dp.dist_km <= COALESCE(s.dist_search_radius_km, 5)
    AND dp.active_cnt < max_stack
    -- Stack candidates: same store OR same-area delivery (same address / same route)
    AND (dp.active_cnt = 0 OR dp.same_store OR dp.same_dropoff)
    AND (
      NOT COALESCE(s.dist_vehicle_rules_enabled, false)
      OR (
        (dp.v_type = 'bike' AND dp.dist_km <= COALESCE(s.dist_bike_max_km, 3))
        OR (dp.v_type = 'motorcycle' AND dp.dist_km <= COALESCE(s.dist_motorcycle_max_km, 8))
        OR (dp.v_type = 'car' AND _order_value >= COALESCE(s.dist_car_min_value, 25))
        OR dp.v_type NOT IN ('bike','motorcycle','car')
      )
    )
  ORDER BY score ASC, dp.dist_km ASC
  LIMIT _limit;
END;
$function$;

-- Source: 20260624073913_0bddfe89-7370-4d99-8af3-8e776b67dd02.sql

ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.touch_customer_app_config() SET search_path = public;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (
        p.proname LIKE 'admin\_%' ESCAPE '\'
        OR p.proname LIKE 'support\_%' ESCAPE '\'
        OR p.proname LIKE 'tx\_%' ESCAPE '\'
        OR p.proname LIKE 'trg\_%' ESCAPE '\'
        OR p.proname IN (
          'bump_driver_shift_cash','bump_quest_progress','capture_prep_duration',
          'claim_quest_reward','cleanup_dispatch_runs','cleanup_stale_dispatch_artifacts',
          'compute_driver_pool_bonus','compute_order_split','create_custom_order',
          'create_driver_earning','create_external_order','credit_customer_wallet',
          'delete_email','enqueue_email','enforce_order_in_service_zone',
          'enforce_wait_bonus_server_calc','guard_basket_only_grows','log_admin_action',
          'log_surge_override_change','move_to_dlq','next_stop_sequence',
          'open_surge_event','place_order','predict_ready_at','quote_driver_payout',
          'read_email_batch','redeem_wallet_credit','refund_order','request_store_promotion',
          'request_wallet_withdrawal','resolve_commission_pct','run_basket_distribution',
          'run_due_basket_distributions','set_order_dispatch','set_order_distance_and_payout',
          'set_predicted_ready_at','settle_order_commission','stamp_order_surge',
          'assign_profile_code','get_treasury_health','count_active_support_agents'
        )
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;


-- Source: 20260625060454_26351406-0225-4eef-8e18-3b49068be4bd.sql
-- Expose dist_offer_timeout_seconds via public RPC and align default with UI (60s)
ALTER TABLE public.platform_settings
  ALTER COLUMN dist_offer_timeout_seconds SET DEFAULT 60;

UPDATE public.platform_settings
  SET dist_offer_timeout_seconds = 60
  WHERE id = 1 AND dist_offer_timeout_seconds IS NULL;

DROP FUNCTION IF EXISTS public.get_platform_settings_public();

CREATE OR REPLACE FUNCTION public.get_platform_settings_public()
RETURNS TABLE(
  platform_service_fee numeric,
  max_cash_cap numeric,
  show_stores_on_driver_map boolean,
  assignment_mode text,
  maintenance_mode boolean,
  maintenance_message text,
  customer_base_fee numeric,
  customer_per_km_fee numeric,
  max_stacked_orders integer,
  stacking_enabled boolean,
  dist_offer_timeout_seconds integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    platform_service_fee,
    max_cash_cap,
    show_stores_on_driver_map,
    assignment_mode,
    maintenance_mode,
    maintenance_message,
    customer_base_fee,
    customer_per_km_fee,
    max_stacked_orders,
    stacking_enabled,
    dist_offer_timeout_seconds
  FROM public.platform_settings
  WHERE id = 1
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_platform_settings_public() TO anon, authenticated, service_role;

-- Source: 20260625062806_f15d0d3c-f8f2-4fee-85ea-454cd408b4d2.sql
GRANT SELECT ON public.stores_public TO anon, authenticated;

-- Source: 20260629051924_b879785f-6824-4fa6-9c55-41e5c2c7a9c9.sql
-- Fix: driver doesn't get paid on cash orders
-- For cash payments, driver share comes directly from collected cash (not from platform pool).
-- amount_owed to admin = cash_collected - driver_share. No pending_driver_payouts queued.

CREATE OR REPLACE FUNCTION public.settle_order_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric := 0;
  pool_amt numeric := 0;
  delivery_amt numeric := 0;
  tip_amt numeric := 0;
  store_extra numeric := 0;
  store_keeps_amt numeric := 0;
  pool_balance numeric := 0;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean := false;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  driver_base_pay numeric := 0;
  locked_payout numeric := 0;
  s_pause boolean := false;
  s_subsidize boolean := false;
  s_low numeric := 0;
  s_alert boolean := true;
  pay_paused boolean := false;
  shortfall numeric := 0;
  queued_amount numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

  SELECT pause_bonus_when_critical, subsidize_min_pay, low_pool_threshold, pool_alert_enabled
    INTO s_pause, s_subsidize, s_low, s_alert
    FROM public.platform_settings WHERE id = 1;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

    IF is_cash THEN
      -- CASH ORDERS: driver already has the money in hand from the customer.
      -- No pool draw, no pending payout, no wallet credit needed.
      -- Driver just owes admin (cash_collected - driver_share).
      pool_take := 0;
      admin_subsidy := 0;

      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );
    ELSE
      -- CARD / ONLINE: pay driver from platform pool, then admin subsidy if needed.
      SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      shortfall := GREATEST(driver_base_pay - pool_balance, 0);

      pay_paused := (COALESCE(s_pause, false)
                     AND NOT COALESCE(s_subsidize, false)
                     AND shortfall > 0
                     AND pool_balance < COALESCE(s_low, 0));

      IF pay_paused THEN
        INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
        VALUES (NEW.driver_id, NEW.id, driver_base_pay + tip_amt, 'pool_insufficient')
        ON CONFLICT (order_id, driver_id) DO NOTHING;

        IF COALESCE(s_alert, true) THEN
          INSERT INTO public.announcements (title, message, target_audience, expires_at)
          VALUES (
            'Driver Buffer χαμηλό',
            'Παραγγελία ' || COALESCE(NEW.external_ref, NEW.id::text)
              || ' δεν πληρώθηκε σε driver (απαιτείται €' || ROUND(driver_base_pay,2)
              || ', διαθέσιμο €' || ROUND(pool_balance,2) || '). Top-up το Driver Buffer.',
            'admin',
            now() + interval '24 hours'
          );
        END IF;

        pool_take := 0;
        admin_subsidy := 0;
        driver_share_total := 0;

        INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
        SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
        WHERE NOT EXISTS (
          SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
        );
      ELSE
        pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
        admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

        IF admin_subsidy > 0 AND NOT COALESCE(s_subsidize, false) THEN
          queued_amount := admin_subsidy;
          INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
          VALUES (NEW.driver_id, NEW.id, queued_amount, 'pool_insufficient')
          ON CONFLICT (order_id, driver_id) DO NOTHING;

          IF COALESCE(s_alert, true) THEN
            INSERT INTO public.announcements (title, message, target_audience, expires_at)
            VALUES (
              'Driver Buffer χαμηλό',
              'Λείπουν €' || ROUND(queued_amount,2) || ' από driver payout (order '
                || COALESCE(NEW.external_ref, NEW.id::text) || '). Top-up το Driver Buffer.',
              'admin',
              now() + interval '24 hours'
            );
          END IF;
          admin_subsidy := 0;
          driver_base_pay := pool_take;
          driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);
        END IF;

        IF pool_take > 0 THEN
          INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
          VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
          UPDATE public.admin_treasury
            SET platform_pool = GREATEST(platform_pool - pool_take, 0),
                lifetime_driver_topup = lifetime_driver_topup + pool_take,
                updated_at = now()
            WHERE id = 1;
        END IF;

        IF admin_subsidy > 0 THEN
          INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
          VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
          UPDATE public.admin_treasury
            SET admin_balance = admin_balance - admin_subsidy,
                updated_at = now()
            WHERE id = 1;
        END IF;

        INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
        SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
        WHERE NOT EXISTS (
          SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
        );

        IF driver_share_total > 0 THEN
          INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
          VALUES (NEW.driver_id, driver_share_total, 0, 0)
          ON CONFLICT (driver_id) DO UPDATE
            SET available_balance = public.driver_wallets.available_balance + driver_share_total,
                updated_at = now();

          INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
          SELECT NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Κέρδος παράδοσης', NEW.id
          WHERE NOT EXISTS (
            SELECT 1 FROM public.wallet_transactions wt
            WHERE wt.order_id = NEW.id
              AND wt.driver_id = NEW.driver_id
              AND wt.type = 'earning_credit'
          );
        END IF;
      END IF;
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, 0);
      IF cash_collected <= 0 THEN
        cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
      END IF;

      IF cash_collected > 0 THEN
        INSERT INTO public.driver_cash_debts (
          driver_id, order_id, cash_collected,
          driver_share, amount_owed, store_share, platform_share, admin_share, settled
        )
        SELECT NEW.driver_id, NEW.id, cash_collected,
               driver_share_total,
               GREATEST(cash_collected - driver_share_total, 0),
               store_keeps_amt, pool_amt + store_extra, admin_amt, false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.driver_cash_debts d WHERE d.order_id = NEW.id AND d.driver_id = NEW.driver_id
        );
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := driver_base_pay;
  RETURN NEW;
END;
$function$;

-- Source: 20260629052052_149a6d88-a91c-4e28-8e77-7d8f107c2383.sql
CREATE OR REPLACE FUNCTION public.settle_order_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric := 0;
  pool_amt numeric := 0;
  delivery_amt numeric := 0;
  tip_amt numeric := 0;
  store_extra numeric := 0;
  store_keeps_amt numeric := 0;
  pool_balance numeric := 0;
  pool_take numeric := 0;
  admin_subsidy numeric := 0;
  is_cash boolean := false;
  cash_collected numeric := 0;
  driver_share_total numeric := 0;
  driver_base_pay numeric := 0;
  locked_payout numeric := 0;
  s_pause boolean := false;
  s_subsidize boolean := false;
  s_low numeric := 0;
  s_alert boolean := true;
  pay_paused boolean := false;
  shortfall numeric := 0;
  queued_amount numeric := 0;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN
    NEW.commission_settled_at := now();
    RETURN NEW;
  END IF;

  SELECT pause_bonus_when_critical, subsidize_min_pay, low_pool_threshold, pool_alert_enabled
    INTO s_pause, s_subsidize, s_low, s_alert
    FROM public.platform_settings WHERE id = 1;

  is_cash         := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt       := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt        := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt    := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  tip_amt         := COALESCE(NEW.tip_amount, 0);
  store_extra     := COALESCE((split->>'store_extra_commission')::numeric, 0);
  store_keeps_amt := COALESCE((split->>'store_keeps')::numeric, 0);

  locked_payout := COALESCE(NEW.driver_payout, 0);
  IF locked_payout > 0 THEN
    driver_base_pay := ROUND(locked_payout::numeric, 2);
  ELSE
    driver_base_pay := public.quote_driver_payout(NEW.store_id, NEW.distance_km);
  END IF;

  IF delivery_amt > driver_base_pay THEN
    driver_base_pay := delivery_amt;
  END IF;

  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    -- ALWAYS pay drivers from the platform pool (cash or card).
    SELECT COALESCE(platform_pool, 0) INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    shortfall := GREATEST(driver_base_pay - pool_balance, 0);

    pay_paused := (COALESCE(s_pause, false)
                   AND NOT COALESCE(s_subsidize, false)
                   AND shortfall > 0
                   AND pool_balance < COALESCE(s_low, 0));

    IF pay_paused THEN
      INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
      VALUES (NEW.driver_id, NEW.id, driver_base_pay + tip_amt, 'pool_insufficient')
      ON CONFLICT (order_id, driver_id) DO NOTHING;

      IF COALESCE(s_alert, true) THEN
        INSERT INTO public.announcements (title, message, target_audience, expires_at)
        VALUES (
          'Driver Buffer χαμηλό',
          'Παραγγελία ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' δεν πληρώθηκε σε driver (απαιτείται €' || ROUND(driver_base_pay,2)
            || ', διαθέσιμο €' || ROUND(pool_balance,2) || '). Top-up το Driver Buffer.',
          'admin',
          now() + interval '24 hours'
        );
      END IF;

      pool_take := 0;
      admin_subsidy := 0;
      driver_share_total := 0;

      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );
    ELSE
      pool_take := LEAST(GREATEST(pool_balance, 0), GREATEST(driver_base_pay, 0));
      admin_subsidy := GREATEST(driver_base_pay - pool_take, 0);

      IF admin_subsidy > 0 AND NOT COALESCE(s_subsidize, false) THEN
        queued_amount := admin_subsidy;
        INSERT INTO public.pending_driver_payouts (driver_id, order_id, amount, reason)
        VALUES (NEW.driver_id, NEW.id, queued_amount, 'pool_insufficient')
        ON CONFLICT (order_id, driver_id) DO NOTHING;

        IF COALESCE(s_alert, true) THEN
          INSERT INTO public.announcements (title, message, target_audience, expires_at)
          VALUES (
            'Driver Buffer χαμηλό',
            'Λείπουν €' || ROUND(queued_amount,2) || ' από driver payout (order '
              || COALESCE(NEW.external_ref, NEW.id::text) || '). Top-up το Driver Buffer.',
            'admin',
            now() + interval '24 hours'
          );
        END IF;
        admin_subsidy := 0;
        driver_base_pay := pool_take;
      END IF;

      driver_share_total := COALESCE(driver_base_pay, 0) + COALESCE(tip_amt, 0);

      IF pool_take > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_payout', NEW.id, 'Driver pay from pool');
        UPDATE public.admin_treasury
          SET platform_pool = GREATEST(platform_pool - pool_take, 0),
              lifetime_driver_topup = lifetime_driver_topup + pool_take,
              updated_at = now()
          WHERE id = 1;
      END IF;

      IF admin_subsidy > 0 THEN
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-admin_subsidy, 'admin', 'driver_subsidy', NEW.id, 'Admin subsidy for driver pay');
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - admin_subsidy,
              updated_at = now()
          WHERE id = 1;
      END IF;

      INSERT INTO public.earnings (driver_id, order_id, base_pay, bonus, tip)
      SELECT NEW.driver_id, NEW.id, driver_base_pay, 0, tip_amt
      WHERE NOT EXISTS (
        SELECT 1 FROM public.earnings e WHERE e.order_id = NEW.id AND e.driver_id = NEW.driver_id
      );

      IF driver_share_total > 0 THEN
        INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
        VALUES (NEW.driver_id, driver_share_total, 0, 0)
        ON CONFLICT (driver_id) DO UPDATE
          SET available_balance = public.driver_wallets.available_balance + driver_share_total,
              updated_at = now();

        INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
        SELECT NEW.driver_id, 'earning_credit', driver_share_total, 'completed', 'Κέρδος παράδοσης', NEW.id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.wallet_transactions wt
          WHERE wt.order_id = NEW.id
            AND wt.driver_id = NEW.driver_id
            AND wt.type = 'earning_credit'
        );
      END IF;
    END IF;

    IF is_cash THEN
      cash_collected := COALESCE(NEW.cash_received, 0);
      IF cash_collected <= 0 THEN
        cash_collected := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) + COALESCE(NEW.tip_amount, 0);
      END IF;

      IF cash_collected > 0 THEN
        INSERT INTO public.driver_cash_debts (
          driver_id, order_id, cash_collected,
          driver_share, amount_owed, store_share, platform_share, admin_share, settled
        )
        SELECT NEW.driver_id, NEW.id, cash_collected,
               driver_share_total, cash_collected, store_keeps_amt, pool_amt + store_extra, admin_amt, false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.driver_cash_debts d WHERE d.order_id = NEW.id AND d.driver_id = NEW.driver_id
        );
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt;
  NEW.driver_payout := driver_share_total;
  NEW.store_charge := store_keeps_amt;
  NEW.driver_pool_bonus := driver_base_pay;
  RETURN NEW;
END;
$function$;

-- Source: 20260630064200_79eadf93-614b-4a59-ae26-b46a9c1ba013.sql
-- Add per-store sequential order number (1..9999, wraps) so each store has its own ID series
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS store_order_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_orders_store_order_number ON public.orders(store_id, store_order_number);

CREATE OR REPLACE FUNCTION public.assign_store_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_num INTEGER;
BEGIN
  IF NEW.store_order_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.store_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(store_order_number), 0)
    INTO last_num
  FROM public.orders
  WHERE store_id = NEW.store_id;

  NEW.store_order_number := (last_num % 9999) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_store_order_number ON public.orders;
CREATE TRIGGER trg_assign_store_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.assign_store_order_number();

-- Backfill existing orders per store in created_at order
WITH ranked AS (
  SELECT id, ((ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY created_at) - 1) % 9999) + 1 AS rn
  FROM public.orders
  WHERE store_order_number IS NULL AND store_id IS NOT NULL
)
UPDATE public.orders o SET store_order_number = ranked.rn
FROM ranked WHERE ranked.id = o.id;

-- Source: 20260701074811_074b9691-aaa6-4454-b7c5-74e63b76a172.sql
CREATE OR REPLACE FUNCTION public.validate_driver_offer_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.action NOT IN ('accepted','declined','timed_out','viewed','released') THEN
    RAISE EXCEPTION 'Invalid action: %', NEW.action;
  END IF;
  RETURN NEW;
END;
$function$;

-- Source: 20260703051405_7d67bdb7-5a72-4b70-8e85-0ac091cd5758.sql

-- 1) Force-assign order to a driver
CREATE OR REPLACE FUNCTION public.admin_force_assign_order(
  p_order_id uuid, p_driver_id uuid, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'support')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.orders
     SET driver_id = p_driver_id,
         status    = CASE WHEN status IN ('pending','placed') THEN 'accepted'::order_status ELSE status END,
         updated_at= now()
   WHERE id = p_order_id;
  UPDATE public.pending_offers
     SET status='cancelled', responded_at=now()
   WHERE order_id = p_order_id AND status='pending';
  PERFORM public.log_admin_action(
    'force_assign_order','order',p_order_id::text,
    format('Ανάθεση σε οδηγό %s%s', p_driver_id, COALESCE(' — '||p_reason,'')),
    NULL);
END;$$;

-- 2) Extend a pending offer
CREATE OR REPLACE FUNCTION public.admin_extend_offer(
  p_offer_id uuid, p_extra_seconds int
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_new timestamptz;
BEGIN
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'support')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_extra_seconds <= 0 OR p_extra_seconds > 600 THEN
    RAISE EXCEPTION 'invalid_seconds';
  END IF;
  UPDATE public.pending_offers
     SET expires_at = GREATEST(expires_at, now()) + make_interval(secs => p_extra_seconds)
   WHERE id = p_offer_id AND status = 'pending'
   RETURNING expires_at INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'offer_not_pending'; END IF;
  PERFORM public.log_admin_action(
    'extend_offer','pending_offer',p_offer_id::text,
    format('+%s sec', p_extra_seconds), NULL);
  RETURN v_new;
END;$$;

-- 3) Pause driver offers (timed break)
CREATE OR REPLACE FUNCTION public.admin_pause_driver_offers(
  p_driver_id uuid, p_minutes int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'support')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_minutes < 0 OR p_minutes > 720 THEN RAISE EXCEPTION 'invalid_minutes'; END IF;
  INSERT INTO public.driver_state (driver_id, on_break, break_until, updated_at)
    VALUES (p_driver_id, p_minutes > 0, CASE WHEN p_minutes>0 THEN now()+make_interval(mins=>p_minutes) ELSE NULL END, now())
    ON CONFLICT (driver_id) DO UPDATE
      SET on_break = EXCLUDED.on_break,
          break_until = EXCLUDED.break_until,
          updated_at = now();
  PERFORM public.log_admin_action(
    CASE WHEN p_minutes>0 THEN 'pause_driver' ELSE 'resume_driver' END,
    'driver',p_driver_id::text,
    CASE WHEN p_minutes>0 THEN format('Pause %s min',p_minutes) ELSE 'Resume' END, NULL);
END;$$;

-- 4) Credit customer wallet (admin only)
CREATE OR REPLACE FUNCTION public.admin_credit_customer_wallet(
  p_customer_id uuid, p_amount numeric, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  IF p_amount <= 0 OR p_amount > 20 THEN RAISE EXCEPTION 'amount_out_of_range'; END IF;
  IF COALESCE(btrim(p_reason),'')='' THEN RAISE EXCEPTION 'reason_required'; END IF;

  INSERT INTO public.customer_wallets (user_id, balance, lifetime_credit)
    VALUES (p_customer_id, p_amount, p_amount)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = public.customer_wallets.balance + EXCLUDED.balance,
          lifetime_credit = public.customer_wallets.lifetime_credit + EXCLUDED.lifetime_credit,
          updated_at = now();

  INSERT INTO public.customer_wallet_ledger (user_id, amount, type, description)
    VALUES (p_customer_id, p_amount, 'admin_credit', p_reason);

  PERFORM public.log_admin_action(
    'credit_customer_wallet','customer',p_customer_id::text,
    format('+%s€ — %s', p_amount, p_reason), NULL);
END;$$;

-- 5) Global dispatch kill switch (via feature_flags key 'dispatch_enabled')
CREATE OR REPLACE FUNCTION public.admin_set_dispatch_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  INSERT INTO public.feature_flags (key, label, description, is_enabled, category)
    VALUES ('dispatch_enabled','Global Dispatch','Master switch για δημιουργία νέων προσφορών', p_enabled, 'orders')
    ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now();
  PERFORM public.log_admin_action(
    CASE WHEN p_enabled THEN 'resume_dispatch' ELSE 'kill_dispatch' END,
    'platform',NULL,
    CASE WHEN p_enabled THEN 'Dispatch resumed' ELSE 'Dispatch KILLED' END, NULL);
END;$$;

-- Grants: admin+support for the first three, admin-only for wallet & kill switch.
REVOKE ALL ON FUNCTION public.admin_force_assign_order(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_extend_offer(uuid,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_pause_driver_offers(uuid,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_credit_customer_wallet(uuid,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_dispatch_enabled(boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_force_assign_order(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_offer(uuid,int)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pause_driver_offers(uuid,int)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_customer_wallet(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_dispatch_enabled(boolean)      TO authenticated;


-- Source: 20260706065302_53176e00-eb76-48e6-8e12-bb6f6617c88e.sql

-- Storage bucket for app branding assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-branding', 'app-branding', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read app-branding" ON storage.objects;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Public read app-branding" ON storage.objects FOR SELECT USING (bucket_id = 'app-branding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins upload app-branding" ON storage.objects;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins upload app-branding" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'app-branding' AND has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins update app-branding" ON storage.objects;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins update app-branding" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'app-branding' AND has_role(auth.uid(), 'admin')) WITH CHECK (bucket_id = 'app-branding' AND has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins delete app-branding" ON storage.objects;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins delete app-branding" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'app-branding' AND has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
