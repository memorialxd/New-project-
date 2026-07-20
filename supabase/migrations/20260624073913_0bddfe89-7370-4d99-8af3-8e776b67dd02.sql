
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
