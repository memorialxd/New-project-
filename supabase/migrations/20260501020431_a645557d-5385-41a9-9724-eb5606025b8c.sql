-- 1) Fix bug in admin_reset_money_to_zero: store_wallets uses available_balance, not balance
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

  SELECT COALESCE(admin_balance, 0), COALESCE(platform_pool, 0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(available_balance), 0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance), 0), COALESCE(SUM(pending_balance), 0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance), 0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed), 0) INTO v_unsettled_debts
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

  UPDATE admin_treasury SET admin_balance = 0, platform_pool = 0, updated_at = now() WHERE id = 1;
  UPDATE store_wallets SET available_balance = 0, updated_at = now();
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0, updated_at = now();
  UPDATE driver_state SET shift_cash_balance = 0, updated_at = now();
  UPDATE driver_cash_debts SET settled = true, settled_at = now(), settled_by = auth.uid()
    WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system', 'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$function$;

-- 2) Per-bag reset functions
CREATE OR REPLACE FUNCTION public.admin_reset_admin_bag()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset bags';
  END IF;
  SELECT admin_balance INTO v_before FROM admin_treasury WHERE id = 1;
  UPDATE admin_treasury SET admin_balance = 0, updated_at = now() WHERE id = 1;
  INSERT INTO admin_treasury_ledger (type, bag, amount, description)
  VALUES ('manual_reset', 'admin', -COALESCE(v_before, 0),
          'Admin bag reset to 0 (was ' || COALESCE(v_before,0) || '€)');
  PERFORM log_admin_action('reset_admin_bag', 'treasury', 'admin',
    'Reset admin bag from ' || COALESCE(v_before,0) || '€ to 0', '{}'::jsonb);
  RETURN COALESCE(v_before, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_platform_pool()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset bags';
  END IF;
  SELECT platform_pool INTO v_before FROM admin_treasury WHERE id = 1;
  UPDATE admin_treasury SET platform_pool = 0, updated_at = now() WHERE id = 1;
  INSERT INTO admin_treasury_ledger (type, bag, amount, description)
  VALUES ('manual_reset', 'platform', -COALESCE(v_before, 0),
          'Platform pool reset to 0 (was ' || COALESCE(v_before,0) || '€)');
  PERFORM log_admin_action('reset_platform_pool', 'treasury', 'platform',
    'Reset platform pool from ' || COALESCE(v_before,0) || '€ to 0', '{}'::jsonb);
  RETURN COALESCE(v_before, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_driver_wallets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_avail numeric; v_pending numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset driver wallets';
  END IF;
  SELECT COALESCE(SUM(available_balance),0), COALESCE(SUM(pending_balance),0)
    INTO v_avail, v_pending FROM driver_wallets;
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0, updated_at = now();
  PERFORM log_admin_action('reset_all_driver_wallets', 'driver_wallets', NULL,
    'Reset all driver wallets (available=' || v_avail || '€, pending=' || v_pending || '€)',
    jsonb_build_object('available_before', v_avail, 'pending_before', v_pending));
  RETURN jsonb_build_object('available_before', v_avail, 'pending_before', v_pending);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_store_wallet(p_store_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store wallets';
  END IF;
  SELECT available_balance INTO v_before FROM store_wallets WHERE store_id = p_store_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Store wallet not found'; END IF;
  UPDATE store_wallets SET available_balance = 0, updated_at = now() WHERE store_id = p_store_id;
  INSERT INTO store_wallet_ledger (store_id, type, amount, description, created_by)
  VALUES (p_store_id, 'manual_reset', -v_before,
          'Store wallet reset to 0 (was ' || v_before || '€)', auth.uid());
  PERFORM log_admin_action('reset_store_wallet', 'store', p_store_id::text,
    'Reset store wallet from ' || v_before || '€ to 0', '{}'::jsonb);
  RETURN v_before;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_store_wallets()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_total numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store wallets';
  END IF;
  SELECT COALESCE(SUM(available_balance),0) INTO v_total FROM store_wallets;
  UPDATE store_wallets SET available_balance = 0, updated_at = now();
  PERFORM log_admin_action('reset_all_store_wallets', 'store_wallets', NULL,
    'Reset all store wallets (total ' || v_total || '€)',
    jsonb_build_object('total_before', v_total));
  RETURN v_total;
END; $$;

-- 3) Extend create_custom_order to accept driver_payout & store_charge overrides (admin/support only)
CREATE OR REPLACE FUNCTION public.create_custom_order(
  p_store_id uuid,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_distance_km numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_items_summary text DEFAULT NULL,
  p_delivery_fee_override numeric DEFAULT NULL,
  p_driver_payout_override numeric DEFAULT NULL,
  p_store_charge_override numeric DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_fee numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_combined_notes text;
  v_is_priv boolean;
BEGIN
  v_is_priv := is_support_or_admin(auth.uid());
  IF NOT v_is_priv THEN
    RAISE EXCEPTION 'Only admin/support can create custom orders';
  END IF;
  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;
  IF p_driver_payout_override IS NOT NULL AND (p_driver_payout_override < 0 OR p_driver_payout_override > 50) THEN
    RAISE EXCEPTION 'Driver payout override must be between 0 and 50€';
  END IF;
  IF p_store_charge_override IS NOT NULL AND (p_store_charge_override < 0 OR p_store_charge_override > 1000) THEN
    RAISE EXCEPTION 'Store charge override must be between 0 and 1000€';
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  IF p_delivery_fee_override IS NOT NULL THEN
    v_fee := p_delivery_fee_override;
  ELSE
    v_fee := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  v_driver_pay := COALESCE(p_driver_payout_override, v_fee);
  v_store_charge := p_store_charge_override; -- NULL = no extra store charge for in-app custom orders

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END
  );

  INSERT INTO orders (
    store_id, status, source,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout
  ) VALUES (
    p_store_id, 'placed', 'manual',
    p_total_amount, v_fee, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, COALESCE(p_payment_method, 'cash'),
    v_store_charge, v_driver_pay
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (v_order_id, COALESCE(p_items_summary, 'Custom order'), 1, p_total_amount);

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_custom_order', 'order', v_order_id::text,
      'Custom order ' || p_total_amount || '€',
      jsonb_build_object('driver_pay', v_driver_pay, 'store_charge', v_store_charge, 'fee', v_fee)
    );
  END IF;

  RETURN v_order_id;
END; $$;