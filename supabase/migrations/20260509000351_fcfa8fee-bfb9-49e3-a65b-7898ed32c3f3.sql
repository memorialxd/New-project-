
-- 1) RESET MONEY TO ZERO -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_money_to_zero()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_admin_bal numeric;
  v_platform_bal numeric;
  v_store_total numeric;
  v_driver_avail numeric;
  v_driver_pending numeric;
  v_driver_cash numeric;
  v_unsettled_debts numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset money';
  END IF;

  SELECT COALESCE(admin_balance,0), COALESCE(platform_pool,0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(available_balance),0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance),0), COALESCE(SUM(pending_balance),0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance),0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed),0) INTO v_unsettled_debts
    FROM driver_cash_debts WHERE settled = false;

  v_snapshot := jsonb_build_object(
    'reset_at', now(),
    'reset_by', auth.uid(),
    'admin_balance_before', v_admin_bal,
    'platform_pool_before', v_platform_bal,
    'store_wallets_total_before', v_store_total,
    'driver_available_total_before', v_driver_avail,
    'driver_pending_total_before', v_driver_pending,
    'driver_shift_cash_total_before', v_driver_cash,
    'unsettled_cash_debts_before', v_unsettled_debts
  );

  UPDATE admin_treasury
     SET admin_balance = 0, platform_pool = 0, updated_at = now()
   WHERE id = 1;

  UPDATE store_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL OR driver_id IS NULL; -- match-all with WHERE

  UPDATE driver_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE driver_state
     SET shift_cash_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE customer_wallets
     SET balance = 0, updated_at = now()
   WHERE user_id IS NOT NULL;

  UPDATE driver_cash_debts
     SET settled = true, settled_at = now(), settled_by = auth.uid()
   WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system',
          'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$function$;

-- store_wallets has no driver_id; rewrite the WHERE properly
CREATE OR REPLACE FUNCTION public.admin_reset_money_to_zero()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_admin_bal numeric;
  v_platform_bal numeric;
  v_store_total numeric;
  v_driver_avail numeric;
  v_driver_pending numeric;
  v_driver_cash numeric;
  v_unsettled_debts numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset money';
  END IF;

  SELECT COALESCE(admin_balance,0), COALESCE(platform_pool,0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(available_balance),0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance),0), COALESCE(SUM(pending_balance),0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance),0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed),0) INTO v_unsettled_debts
    FROM driver_cash_debts WHERE settled = false;

  v_snapshot := jsonb_build_object(
    'reset_at', now(), 'reset_by', auth.uid(),
    'admin_balance_before', v_admin_bal,
    'platform_pool_before', v_platform_bal,
    'store_wallets_total_before', v_store_total,
    'driver_available_total_before', v_driver_avail,
    'driver_pending_total_before', v_driver_pending,
    'driver_shift_cash_total_before', v_driver_cash,
    'unsettled_cash_debts_before', v_unsettled_debts
  );

  UPDATE admin_treasury
     SET admin_balance = 0, platform_pool = 0, updated_at = now()
   WHERE id = 1;

  UPDATE store_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_state
     SET shift_cash_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE customer_wallets
     SET balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_cash_debts
     SET settled = true, settled_at = now(), settled_by = auth.uid()
   WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system',
          'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$function$;


-- 2) WIPE TRANSACTIONS -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wipe_transactions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_orders int; v_order_items int; v_earnings int;
  v_admin_ledger int; v_store_ledger int; v_customer_ledger int;
  v_monthly int; v_debts int; v_offers int;
  v_fraud int; v_tickets int; v_driver_notifs int;
  v_pending_offers int; v_refunds int; v_reviews int;
  v_rewards_hist int; v_groups int; v_wallet_tx int;
  v_wait_bonus int; v_summary int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can wipe transactions';
  END IF;

  SELECT COUNT(*) INTO v_orders FROM orders;
  SELECT COUNT(*) INTO v_order_items FROM order_items;
  SELECT COUNT(*) INTO v_earnings FROM earnings;
  SELECT COUNT(*) INTO v_admin_ledger FROM admin_treasury_ledger;
  SELECT COUNT(*) INTO v_store_ledger FROM store_wallet_ledger;
  SELECT COUNT(*) INTO v_customer_ledger FROM customer_wallet_ledger;
  SELECT COUNT(*) INTO v_monthly FROM monthly_reports;
  SELECT COUNT(*) INTO v_debts FROM driver_cash_debts;
  SELECT COUNT(*) INTO v_offers FROM driver_offer_events;
  SELECT COUNT(*) INTO v_fraud FROM fraud_signals;
  SELECT COUNT(*) INTO v_tickets FROM support_tickets;
  SELECT COUNT(*) INTO v_driver_notifs FROM driver_notifications;
  SELECT COUNT(*) INTO v_pending_offers FROM pending_offers;
  SELECT COUNT(*) INTO v_refunds FROM refunds;
  SELECT COUNT(*) INTO v_reviews FROM reviews;
  SELECT COUNT(*) INTO v_rewards_hist FROM reward_history;
  SELECT COUNT(*) INTO v_groups FROM group_orders;
  SELECT COUNT(*) INTO v_wallet_tx FROM wallet_transactions;
  SELECT COUNT(*) INTO v_wait_bonus FROM wait_time_bonuses;
  SELECT COUNT(*) INTO v_summary FROM store_daily_summary_log;

  v_snapshot := jsonb_build_object(
    'wiped_at', now(), 'wiped_by', auth.uid(),
    'orders_deleted', v_orders,
    'order_items_deleted', v_order_items,
    'earnings_deleted', v_earnings,
    'admin_ledger_deleted', v_admin_ledger,
    'store_ledger_deleted', v_store_ledger,
    'customer_ledger_deleted', v_customer_ledger,
    'monthly_reports_deleted', v_monthly,
    'cash_debts_deleted', v_debts,
    'offer_events_deleted', v_offers,
    'pending_offers_deleted', v_pending_offers,
    'fraud_signals_deleted', v_fraud,
    'support_tickets_deleted', v_tickets,
    'driver_notifications_deleted', v_driver_notifs,
    'refunds_deleted', v_refunds,
    'reviews_deleted', v_reviews,
    'reward_history_deleted', v_rewards_hist,
    'group_orders_deleted', v_groups,
    'wallet_transactions_deleted', v_wallet_tx,
    'wait_time_bonuses_deleted', v_wait_bonus,
    'store_daily_summary_deleted', v_summary
  );

  -- Delete in dependency order, all with WHERE
  DELETE FROM order_item_modifiers WHERE order_item_id IS NOT NULL;
  DELETE FROM order_items           WHERE order_id IS NOT NULL;
  DELETE FROM earnings              WHERE id IS NOT NULL;
  DELETE FROM driver_cash_debts     WHERE id IS NOT NULL;
  DELETE FROM driver_offer_events   WHERE id IS NOT NULL;
  DELETE FROM pending_offers        WHERE id IS NOT NULL;
  DELETE FROM wait_time_bonuses     WHERE id IS NOT NULL;
  DELETE FROM wallet_transactions   WHERE id IS NOT NULL;
  DELETE FROM refunds               WHERE id IS NOT NULL;
  DELETE FROM reviews               WHERE id IS NOT NULL;
  DELETE FROM reward_history        WHERE id IS NOT NULL;
  DELETE FROM admin_treasury_ledger WHERE id IS NOT NULL;
  DELETE FROM store_wallet_ledger   WHERE id IS NOT NULL;
  DELETE FROM customer_wallet_ledger WHERE id IS NOT NULL;
  DELETE FROM monthly_reports       WHERE id IS NOT NULL;
  DELETE FROM fraud_signals         WHERE id IS NOT NULL;
  DELETE FROM ticket_messages       WHERE id IS NOT NULL;
  DELETE FROM support_tickets       WHERE id IS NOT NULL;
  DELETE FROM driver_notifications  WHERE id IS NOT NULL;
  DELETE FROM group_order_participants WHERE id IS NOT NULL;
  DELETE FROM group_orders          WHERE id IS NOT NULL;
  DELETE FROM store_daily_summary_log WHERE id IS NOT NULL;
  -- orders has self-FK; null it first
  UPDATE orders SET stacked_with_order_id = NULL WHERE stacked_with_order_id IS NOT NULL;
  DELETE FROM orders                WHERE id IS NOT NULL;

  -- Reset every balance to absolute zero (incl. lifetime)
  UPDATE admin_treasury
     SET admin_balance = 0, platform_pool = 0,
         lifetime_admin_earned = 0, lifetime_platform_earned = 0,
         lifetime_driver_topup = 0, updated_at = now()
   WHERE id = 1;

  UPDATE store_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_wallets
     SET available_balance = 0, pending_balance = 0, total_withdrawn = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_state
     SET shift_cash_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE customer_wallets
     SET balance = 0, lifetime_credit = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE customer_rewards
     SET points = 0, lifetime_points = 0, tier = 'bronze', updated_at = now()
   WHERE id IS NOT NULL;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'wipe_transactions', 'system',
          'Wiped all transactional data and reset balances to zero', v_snapshot);

  RETURN v_snapshot;
END;
$function$;


-- 3) PRICING MODEL VIEW -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_pricing_model
WITH (security_invoker=on) AS
SELECT
  ps.id,
  GREATEST(COALESCE(ps.admin_share_pct, 5), 5)               AS admin_pct,
  GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10) AS driver_pool_pct,
  GREATEST(COALESCE(ps.default_commission_pct, 15), 15)      AS default_commission_pct,
  100 - GREATEST(COALESCE(ps.default_commission_pct, 15), 15) AS default_store_keeps_pct
FROM public.platform_settings ps
WHERE ps.id = 1;

GRANT SELECT ON public.v_pricing_model TO authenticated;
