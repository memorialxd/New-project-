
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

  v_snapshot := jsonb_build_object(
    'wiped_at', now(),
    'wiped_by', auth.uid(),
    'orders_deleted', v_orders,
    'order_items_deleted', v_order_items,
    'earnings_deleted', v_earnings,
    'admin_ledger_deleted', v_admin_ledger,
    'store_ledger_deleted', v_store_ledger,
    'customer_ledger_deleted', v_customer_ledger,
    'monthly_reports_deleted', v_monthly,
    'cash_debts_deleted', v_debts,
    'offer_events_deleted', v_offers,
    'fraud_signals_deleted', v_fraud,
    'support_tickets_deleted', v_tickets,
    'driver_notifications_deleted', v_driver_notifs
  );

  -- Children first
  DELETE FROM order_item_modifiers WHERE order_item_id IN (SELECT id FROM order_items);
  DELETE FROM order_items;
  DELETE FROM earnings;
  DELETE FROM driver_cash_debts;
  DELETE FROM driver_offer_events;
  DELETE FROM admin_treasury_ledger;
  DELETE FROM store_wallet_ledger;
  DELETE FROM customer_wallet_ledger;
  DELETE FROM monthly_reports;
  DELETE FROM fraud_signals;
  DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets);
  DELETE FROM support_tickets;
  DELETE FROM driver_notifications;
  DELETE FROM wallet_transactions;
  DELETE FROM orders;

  -- Reset every balance to absolute zero (incl. lifetime)
  UPDATE admin_treasury SET admin_balance = 0, platform_pool = 0,
    lifetime_admin_earned = 0, lifetime_platform_earned = 0, lifetime_driver_topup = 0,
    updated_at = now() WHERE id = 1;
  UPDATE store_wallets SET available_balance = 0, pending_balance = 0,
    lifetime_earnings = 0, updated_at = now();
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0,
    total_withdrawn = 0, updated_at = now();
  UPDATE driver_state SET shift_cash_balance = 0, updated_at = now();
  UPDATE customer_wallets SET balance = 0, lifetime_credit = 0, updated_at = now();
  UPDATE customer_rewards SET points = 0, lifetime_points = 0, tier = 'bronze', updated_at = now();

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'wipe_transactions', 'system',
          'Wiped all transactional data and reset balances to zero', v_snapshot);

  RETURN v_snapshot;
END;
$function$;
