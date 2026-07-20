-- 1. Add Smart Buffer fields to stores
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS ext_smart_target_pct numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ext_smart_min_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ext_smart_max_pct numeric NOT NULL DEFAULT 20;

-- 2. Allow new billing mode value
CREATE OR REPLACE FUNCTION public.validate_store_billing_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.ext_billing_mode NOT IN ('commission','flat_fee','driver_plus_margin','smart_buffer') THEN
    RAISE EXCEPTION 'Invalid ext_billing_mode: %', NEW.ext_billing_mode;
  END IF;
  IF NEW.ext_smart_min_pct < 5 OR NEW.ext_smart_min_pct > 30 THEN
    RAISE EXCEPTION 'ext_smart_min_pct must be between 5 and 30';
  END IF;
  IF NEW.ext_smart_max_pct < NEW.ext_smart_min_pct OR NEW.ext_smart_max_pct > 40 THEN
    RAISE EXCEPTION 'ext_smart_max_pct must be >= min and <= 40';
  END IF;
  IF NEW.ext_smart_target_pct < NEW.ext_smart_min_pct OR NEW.ext_smart_target_pct > NEW.ext_smart_max_pct THEN
    RAISE EXCEPTION 'ext_smart_target_pct must be between min and max';
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Add External Buffer Bag column to admin treasury
ALTER TABLE public.admin_treasury
  ADD COLUMN IF NOT EXISTS external_buffer_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_external_buffer_in numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_external_buffer_out numeric NOT NULL DEFAULT 0;

-- 4. Helper: dynamic smart-buffer pricing for one external order
CREATE OR REPLACE FUNCTION public.compute_smart_buffer_charge(
  p_total numeric,
  p_driver_cost numeric,
  p_target_pct numeric,
  p_min_pct numeric,
  p_max_pct numeric,
  p_buffer_balance numeric
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_charge_at_target numeric;
  v_profit_at_target numeric;
  v_charge numeric;
  v_buffer_delta numeric := 0;
  v_pct numeric;
BEGIN
  v_charge_at_target := ROUND(p_total * p_target_pct / 100.0, 2);
  v_profit_at_target := v_charge_at_target - p_driver_cost;

  IF v_profit_at_target >= 1 THEN
    -- Comfortable order → charge minimum, deposit surplus to buffer
    v_pct := p_min_pct;
    v_charge := ROUND(p_total * v_pct / 100.0, 2);
    v_buffer_delta := ROUND(v_charge_at_target - v_charge, 2); -- positive = into buffer
  ELSIF v_profit_at_target < 0 THEN
    -- Loss order → push toward max, withdraw shortfall from buffer
    v_pct := p_max_pct;
    v_charge := ROUND(p_total * v_pct / 100.0, 2);
    v_buffer_delta := ROUND(v_charge - v_charge_at_target, 2) * -1; -- negative = out of buffer
  ELSE
    -- Marginal → straight at target
    v_pct := p_target_pct;
    v_charge := v_charge_at_target;
    v_buffer_delta := 0;
  END IF;

  RETURN jsonb_build_object(
    'charge', v_charge,
    'pct', v_pct,
    'buffer_delta', v_buffer_delta,
    'target_charge', v_charge_at_target,
    'driver_cost', p_driver_cost
  );
END;
$$;

-- 5. Update create_external_order to support smart_buffer mode
CREATE OR REPLACE FUNCTION public.create_external_order(
  p_store_id uuid,
  p_source text,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_distance_km numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_driver_payout_override numeric DEFAULT NULL,
  p_store_charge_override numeric DEFAULT NULL,
  p_items_summary text DEFAULT NULL,
  p_payment_method text DEFAULT 'external'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_treasury admin_treasury%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
  v_pm text;
  v_smart jsonb;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  v_is_priv  := is_support_or_admin(auth.uid());
  v_is_owner := (v_store.owner_id = auth.uid());

  IF NOT (v_is_priv OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to create orders for this store';
  END IF;

  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  IF NOT v_is_priv AND (p_driver_payout_override IS NOT NULL OR p_store_charge_override IS NOT NULL) THEN
    RAISE EXCEPTION 'Only admin/support can override pricing';
  END IF;

  v_pm := COALESCE(NULLIF(p_payment_method, ''), 'external');
  IF v_pm NOT IN ('cash','card','external') THEN
    RAISE EXCEPTION 'Invalid payment_method (got %)', v_pm;
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;
  SELECT * INTO v_treasury FROM admin_treasury WHERE id = 1;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSE
    CASE v_store.ext_billing_mode
      WHEN 'commission'         THEN v_store_charge := ROUND((p_total_amount * v_store.ext_commission_pct / 100)::numeric, 2);
      WHEN 'flat_fee'           THEN v_store_charge := v_store.ext_flat_fee;
      WHEN 'driver_plus_margin' THEN v_store_charge := ROUND((v_driver_pay * (1 + v_store.ext_margin_pct / 100))::numeric, 2);
      WHEN 'smart_buffer'       THEN
        v_smart := compute_smart_buffer_charge(
          p_total_amount, v_driver_pay,
          v_store.ext_smart_target_pct, v_store.ext_smart_min_pct, v_store.ext_smart_max_pct,
          COALESCE(v_treasury.external_buffer_balance, 0)
        );
        v_store_charge := (v_smart->>'charge')::numeric;
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END,
    CASE WHEN v_pm = 'cash' THEN '💶 ΜΕΤΡΗΤΑ — εισπράττει ο οδηγός' END,
    CASE WHEN v_smart IS NOT NULL THEN '⚖️ Smart ' || (v_smart->>'pct') || '% (buffer Δ ' || (v_smart->>'buffer_delta') || '€)' END
  );

  INSERT INTO orders (
    store_id, status, source, external_ref,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout, platform_profit
  ) VALUES (
    p_store_id, 'placed', p_source, p_external_ref,
    p_total_amount, v_driver_pay, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, v_pm,
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  -- Apply smart buffer ledger entry immediately (independent of delivery settlement)
  IF v_smart IS NOT NULL AND (v_smart->>'buffer_delta')::numeric <> 0 THEN
    DECLARE
      v_delta numeric := (v_smart->>'buffer_delta')::numeric;
      v_new_balance numeric;
    BEGIN
      -- SAFETY: never let buffer go below 0 by drawing from driver pool
      v_new_balance := COALESCE(v_treasury.external_buffer_balance, 0) + v_delta;
      IF v_new_balance < 0 THEN
        -- Cap withdrawal at available buffer; admin alert needed
        v_delta := -COALESCE(v_treasury.external_buffer_balance, 0);
      END IF;

      IF v_delta <> 0 THEN
        UPDATE admin_treasury
          SET external_buffer_balance = external_buffer_balance + v_delta,
              lifetime_external_buffer_in  = lifetime_external_buffer_in  + GREATEST(v_delta, 0),
              lifetime_external_buffer_out = lifetime_external_buffer_out + GREATEST(-v_delta, 0),
              updated_at = now()
          WHERE id = 1;

        INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
        VALUES (
          v_order_id,
          CASE WHEN v_delta > 0 THEN 'external_buffer_in' ELSE 'external_buffer_out' END,
          'external_buffer',
          v_delta,
          'Smart buffer ' || (v_smart->>'pct') || '% on €' || p_total_amount
        );
      END IF;
    END;
  END IF;

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' (' || v_pm || ') for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'payment_method', v_pm,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit,
        'smart', v_smart
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;