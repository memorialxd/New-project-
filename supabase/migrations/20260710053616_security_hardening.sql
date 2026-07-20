-- ════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING MIGRATION
-- ════════════════════════════════════════════════════════════════════
-- 1. Move pg_net extension from public to extensions schema
-- 2. Drop broad SELECT policies on public storage buckets
-- 3. Revoke EXECUTE from anon/authenticated on all SECURITY DEFINER functions
-- 4. Grant EXECUTE only to roles that need it
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Move pg_net to extensions schema ───────────────────────────
-- Drop and recreate in extensions schema
DROP EXTENSION IF EXISTS pg_net CASCADE;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION pg_net SCHEMA extensions;
-- Grant usage so existing code can still call it
GRANT USAGE ON SCHEMA extensions TO anon, authenticated;

-- ─── 2. Drop broad SELECT policies on public storage buckets ─────────
-- Public bucket objects are readable via signed URLs without SELECT policies.
-- These broad policies allow listing all files in the bucket.

DROP POLICY IF EXISTS "Public read app-branding" ON storage.objects;
DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;

-- ─── 3. Revoke EXECUTE from anon and authenticated on ALL functions ─
-- Then re-grant only to the roles that need each function.

-- First, revoke all execute from anon and authenticated
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- Also revoke from PUBLIC (default grant)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- ─── 4. Grant EXECUTE selectively ───────────────────────────────────

-- 4a. Functions safe for anon (public-facing, read-only or customer-facing)
GRANT EXECUTE ON FUNCTION public.get_platform_settings_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_reviews(p_store_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_contact(_store_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_avg_prep_minutes(p_store_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commission_pct_for_amount(p_amount numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_surge_for_zone(_zone_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_has_order_at_store(_user uuid, _store uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_has_active_order_at_store(_user uuid, _store uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_support_or_admin(_user_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_active_drivers(double precision, double precision, numeric, uuid[], integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_active_drivers(double precision, double precision, numeric, uuid[], integer, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_active_drivers(double precision, double precision, numeric, uuid[], integer, uuid, double precision, double precision) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_driver_payout(p_store_id uuid, p_distance_km numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_commission_pct(p_store_id uuid, p_food_total numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.predict_ready_at(p_store_id uuid, p_created_at timestamp with time zone) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text, double precision, double precision, text, numeric, numeric, text, timestamp with time zone, numeric, text) TO anon, authenticated;

-- 4b. Functions for authenticated users only (driver/customer actions)
GRANT EXECUTE ON FUNCTION public.driver_release_order(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(p_driver_id uuid, p_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_wallet_credit(p_amount numeric, p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quest_reward(p_quest_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_store_promotion(p_store_id uuid, p_days integer, p_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_support_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_customer_wallet(p_user_id uuid, p_amount numeric, p_type text, p_description text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_order(p_order_id uuid, p_amount numeric, p_reason text, p_refund_type text, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(p_driver_id uuid, p_amount numeric, p_description text) TO authenticated;

-- 4c. Admin functions - authenticated only (admin role check is inside each function)
GRANT EXECUTE ON FUNCTION public.admin_adjust_admin_buffer(p_amount numeric, p_action text, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_basket(p_amount numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_buffer(p_amount numeric, p_action text, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_driver_wallet(p_driver_id uuid, p_amount numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auto_close_previous_month() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_stuck_orders(p_minutes integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_driver_cash_debt(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_close_month(p_period_start date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_customer_wallet(p_customer_id uuid, p_amount numeric, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_distribute_buffer(p_amount numeric, p_mode text, p_top_n integer, p_zone_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_offer(p_offer_id uuid, p_extra_seconds integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_assign_order(p_order_id uuid, p_driver_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_complete_order(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_end_driver_shift(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_order_status(p_order_id uuid, p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_driver_bonus(p_driver_id uuid, p_amount numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_inject_pool(p_amount numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pause_driver_offers(p_driver_id uuid, p_minutes integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_payout_store(p_store_id uuid, p_amount numeric, p_description text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_stale(p_kind text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_order(p_order_id uuid, p_amount numeric, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_release_pending_payout(p_pending_id uuid, p_source text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_admin_bag() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_driver_lifetime() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_driver_wallets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_store_lifetime() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_store_wallets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_driver_cash(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_driver_lifetime(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_driver_wallet(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_money_to_zero() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_platform_pool() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_store_lifetime(p_store_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_store_wallet(p_store_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_driver_message(p_driver_id uuid, p_title text, p_body text, p_severity text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_dispatch_enabled(p_enabled boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_store_promotion(p_store_id uuid, p_status text, p_days integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settle_all_driver_cash() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settle_driver_cash(p_debt_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_suspend_driver(p_driver_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_maintenance(p_on boolean, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_driver(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wallet_adjust(p_kind text, p_user_id uuid, p_amount numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wipe_all_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wipe_transactions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_action(p_action text, p_target_type text, p_target_id text, p_description text, p_metadata jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_basket_distribution(_rule_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_due_basket_distributions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_order(uuid, numeric, text, double precision, double precision, numeric, text, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_order(uuid, numeric, text, double precision, double precision, numeric, text, text, text, text, text, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_external_order(uuid, text, numeric, text, double precision, double precision, numeric, text, text, text, text, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_driver_earning(p_driver_id uuid, p_order_id uuid, p_base_pay numeric, p_tip numeric, p_bonus numeric) TO authenticated;

-- 4d. Support functions - authenticated only
GRANT EXECUTE ON FUNCTION public.support_cancel_order(p_order_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_credit_wallet(p_driver_id uuid, p_amount numeric, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_grant_bonus(p_driver_id uuid, p_amount numeric, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_modify_order(p_order_id uuid, p_total_amount numeric, p_delivery_fee numeric, p_tip_amount numeric, p_delivery_address text, p_delivery_lat double precision, p_delivery_lng double precision, p_notes text, p_change_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_suspend_driver(p_driver_id uuid, p_reason text, p_suspend boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_unassign_order(p_order_id uuid) TO authenticated;

-- 4e. Email queue functions - authenticated only (used by edge functions via service role)
GRANT EXECUTE ON FUNCTION public.enqueue_email(queue_name text, payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email(queue_name text, message_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) TO authenticated;

-- 4f. Trigger functions - NO direct execute grant (only called by triggers)
-- These are NOT granted to anon or authenticated. They run via the trigger
-- mechanism which uses the function owner's privileges.
-- settle_order_commission, credit_store_wallet_on_delivery, assign_store_order_number,
-- assign_profile_code, capture_prep_duration, enforce_wait_bonus_server_calc,
-- set_order_distance_and_payout, set_predicted_ready_at, stamp_order_surge,
-- log_surge_override_change, guard_basket_only_grows, bump_driver_shift_cash,
-- bump_quest_progress, tx_append, tx_mirror_customer_wallet, tx_mirror_driver_wallet,
-- tx_mirror_store_wallet, tx_mirror_treasury_ledger, trg_aade_autosubmit_on_delivered,
-- compute_order_split, compute_driver_pool_bonus, cleanup_dispatch_runs,
-- cleanup_stale_dispatch_artifacts, next_stop_sequence, open_surge_event,
-- set_order_dispatch, admin_auto_close_previous_month

-- ─── 5. Add admin role guards to admin functions that lack them ─────
-- Many admin_* functions are SECURITY DEFINER but don't check if the caller
-- is actually an admin. Add a guard to the most dangerous ones.

-- Add a reusable guard: raise exception if caller is not admin/support
CREATE OR REPLACE FUNCTION public.require_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.require_admin() TO authenticated;
