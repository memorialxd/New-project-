CREATE OR REPLACE FUNCTION public.admin_wipe_all_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can wipe data';
  END IF;

  DELETE FROM public.order_item_modifiers;
  DELETE FROM public.order_items;
  DELETE FROM public.earnings;
  DELETE FROM public.refunds;
  DELETE FROM public.reviews;
  DELETE FROM public.driver_offer_events;
  DELETE FROM public.orders;

  DELETE FROM public.menu_item_modifiers;
  DELETE FROM public.menu_items;
  DELETE FROM public.promo_codes;
  DELETE FROM public.announcements;
  DELETE FROM public.demand_zones;
  DELETE FROM public.surge_zones;
  DELETE FROM public.canned_replies;

  DELETE FROM public.customer_wallet_ledger;
  DELETE FROM public.customer_favorites;
  DELETE FROM public.customer_referrals;
  DELETE FROM public.reward_history;
  DELETE FROM public.saved_addresses;
  DELETE FROM public.group_order_participants;
  DELETE FROM public.group_orders;

  DELETE FROM public.ticket_messages;
  DELETE FROM public.support_tickets;
  DELETE FROM public.support_team_messages;
  DELETE FROM public.fraud_signals;

  DELETE FROM public.driver_locations;
  DELETE FROM public.wallet_transactions;
  DELETE FROM public.driver_referrals;
  DELETE FROM public.wait_time_bonuses;

  UPDATE public.driver_wallets SET available_balance = 0, pending_balance = 0, total_withdrawn = 0;
  UPDATE public.driver_state SET shift_cash_balance = 0, shift_started_at = NULL, on_break = false, break_until = NULL;
  UPDATE public.customer_wallets SET balance = 0, lifetime_credit = 0;
  UPDATE public.customer_rewards SET points = 0, lifetime_points = 0, tier = 'bronze';

  PERFORM public.log_admin_action(
    'wipe_all_data',
    'platform',
    NULL,
    'Διαγράφηκαν όλα τα δεδομένα και μηδενίστηκαν οι μετρητές',
    '{}'::jsonb
  );
END;
$$;