
-- 1) place_order: block same-coords (pickup == delivery) orders
CREATE OR REPLACE FUNCTION public.place_order(p_store_id uuid, p_items jsonb, p_delivery_address text, p_delivery_latitude double precision, p_delivery_longitude double precision, p_payment_method text, p_tip_amount numeric, p_delivery_fee numeric, p_notes text, p_scheduled_for timestamp with time zone, p_distance_km numeric, p_promo_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_promo record;
  v_promo_id uuid := NULL;
  v_order_id uuid;
  v_item jsonb;
  v_menu record;
  v_qty int;
  v_total numeric;
  v_fee numeric := COALESCE(p_delivery_fee, 0);
  v_tip numeric := GREATEST(COALESCE(p_tip_amount, 0), 0);
  v_status order_status;
  v_store_lat double precision;
  v_store_lon double precision;
  v_dist_m numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'No items'; END IF;
  IF p_payment_method NOT IN ('cash','card') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;

  -- Same-address guard: reject when delivery coords are within ~30m of the store.
  SELECT latitude, longitude INTO v_store_lat, v_store_lon FROM public.stores WHERE id = p_store_id;
  IF v_store_lat IS NOT NULL AND v_store_lon IS NOT NULL
     AND p_delivery_latitude IS NOT NULL AND p_delivery_longitude IS NOT NULL THEN
    v_dist_m := 6371000 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_store_lat)) * cos(radians(p_delivery_latitude))
      * cos(radians(p_delivery_longitude) - radians(v_store_lon))
      + sin(radians(v_store_lat)) * sin(radians(p_delivery_latitude))
    )));
    IF v_dist_m < 30 THEN
      RAISE EXCEPTION 'Η διεύθυνση παράδοσης συμπίπτει με τη διεύθυνση του καταστήματος. Διάλεξε διαφορετική.';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price, mi.store_id, mi.is_available, mi.is_snoozed
      INTO v_menu FROM public.menu_items mi WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found'; END IF;
    IF v_menu.store_id <> p_store_id THEN RAISE EXCEPTION 'Menu item does not belong to store'; END IF;
    IF COALESCE(v_menu.is_available, true) = false OR COALESCE(v_menu.is_snoozed, false) = true THEN
      RAISE EXCEPTION 'Menu item unavailable: %', v_menu.name;
    END IF;
    v_subtotal := v_subtotal + (v_menu.price * v_qty);
  END LOOP;

  IF p_promo_code IS NOT NULL AND length(trim(p_promo_code)) > 0 THEN
    SELECT * INTO v_promo FROM public.promo_codes
      WHERE lower(code) = lower(trim(p_promo_code)) AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR current_uses < max_uses)
        AND (store_id IS NULL OR store_id = p_store_id)
        AND min_order_amount <= v_subtotal LIMIT 1;
    IF FOUND THEN
      v_promo_id := v_promo.id;
      IF v_promo.discount_type = 'percentage' THEN
        v_discount := LEAST(v_subtotal, v_subtotal * (v_promo.discount_value / 100));
      ELSE
        v_discount := LEAST(v_subtotal, v_promo.discount_value);
      END IF;
    END IF;
  END IF;

  v_total := GREATEST(0, v_subtotal - v_discount);
  v_status := CASE WHEN p_payment_method = 'card' THEN 'pending'::order_status ELSE 'placed'::order_status END;

  INSERT INTO public.orders (
    customer_id, store_id, status, payment_method,
    total_amount, delivery_fee, tip_amount,
    delivery_address, delivery_latitude, delivery_longitude,
    distance_km, notes, scheduled_for
  ) VALUES (
    v_user, p_store_id, v_status, p_payment_method,
    v_total, v_fee, v_tip,
    p_delivery_address, p_delivery_latitude, p_delivery_longitude,
    p_distance_km, NULLIF(p_notes, ''), p_scheduled_for
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price INTO v_menu FROM public.menu_items mi WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    INSERT INTO public.order_items (order_id, menu_item_id, name, quantity, unit_price)
    VALUES (v_order_id, v_menu.id, v_menu.name, v_qty, v_menu.price);
  END LOOP;

  IF v_promo_id IS NOT NULL THEN
    UPDATE public.promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo_id;
  END IF;

  RETURN v_order_id;
END;
$function$;

-- 2) Mission Control RPCs (admin-only)

-- Force-complete an order (sets status to delivered; commission trigger handles rest)
CREATE OR REPLACE FUNCTION public.admin_force_complete_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.orders
     SET status = 'delivered'::order_status,
         delivered_at = COALESCE(delivered_at, now())
   WHERE id = p_order_id;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description)
  VALUES (auth.uid(), 'force_complete_order', 'order', p_order_id::text, 'Admin force-completed order');
END $$;
GRANT EXECUTE ON FUNCTION public.admin_force_complete_order(uuid) TO authenticated;

-- Credit/debit any wallet (driver or customer)
CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(p_kind text, p_user_id uuid, p_amount numeric, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'amount must be non-zero'; END IF;

  IF p_kind = 'driver' THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance)
    VALUES (p_user_id, GREATEST(0, p_amount))
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = GREATEST(0, public.driver_wallets.available_balance + p_amount),
          updated_at = now()
    RETURNING available_balance INTO v_new;
    INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (p_user_id, CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END, p_amount, 'completed', COALESCE(p_note,'Admin adjustment'));
  ELSIF p_kind = 'customer' THEN
    INSERT INTO public.customer_wallets (user_id, balance, lifetime_credit)
    VALUES (p_user_id, GREATEST(0, p_amount), GREATEST(0, p_amount))
    ON CONFLICT (user_id) DO UPDATE
      SET balance = GREATEST(0, public.customer_wallets.balance + p_amount),
          lifetime_credit = public.customer_wallets.lifetime_credit + GREATEST(0, p_amount),
          updated_at = now()
    RETURNING balance INTO v_new;
    INSERT INTO public.customer_wallet_ledger (user_id, type, amount, description)
    VALUES (p_user_id, CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END, p_amount, COALESCE(p_note,'Admin adjustment'));
  ELSE
    RAISE EXCEPTION 'invalid wallet kind: %', p_kind;
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), 'wallet_adjust', p_kind, p_user_id::text,
          format('%s %s €%s', CASE WHEN p_amount>=0 THEN 'credit' ELSE 'debit' END, p_kind, p_amount),
          jsonb_build_object('amount', p_amount, 'note', p_note));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_wallet_adjust(text, uuid, numeric, text) TO authenticated;

-- Toggle maintenance mode (kill switch)
CREATE OR REPLACE FUNCTION public.admin_toggle_maintenance(p_on boolean, p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.platform_settings
     SET maintenance_mode = p_on,
         maintenance_message = COALESCE(p_message, maintenance_message)
   WHERE id = 1;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description)
  VALUES (auth.uid(), CASE WHEN p_on THEN 'maintenance_on' ELSE 'maintenance_off' END, 'platform', '1', COALESCE(p_message, ''));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_toggle_maintenance(boolean, text) TO authenticated;

-- Purge stale rows (dispatch_runs, dispatch_offers, audit log, driver_offer_events)
CREATE OR REPLACE FUNCTION public.admin_purge_stale(p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_kind = 'dispatch_runs' THEN
    DELETE FROM public.dispatch_runs WHERE started_at < now() - interval '24 hours';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'offer_events' THEN
    DELETE FROM public.driver_offer_events WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'audit' THEN
    DELETE FROM public.admin_audit_log WHERE created_at < now() - interval '90 days';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unknown purge kind: %', p_kind;
  END IF;
  RETURN jsonb_build_object('purged', v_count, 'kind', p_kind);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_purge_stale(text) TO authenticated;

-- Force-cancel stuck pending orders older than threshold (minutes)
CREATE OR REPLACE FUNCTION public.admin_cancel_stuck_orders(p_minutes int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.orders
     SET status = 'cancelled'::order_status
   WHERE status IN ('pending','placed') AND created_at < now() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), 'cancel_stuck_orders', 'orders', 'bulk', format('Cancelled %s stuck orders', v_count), jsonb_build_object('minutes', p_minutes, 'count', v_count));
  RETURN jsonb_build_object('cancelled', v_count);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_cancel_stuck_orders(int) TO authenticated;
