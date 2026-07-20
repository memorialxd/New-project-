
-- 1) Move any remaining External Buffer balance into the Driver Pool (platform_pool)
UPDATE public.admin_treasury
SET
  platform_pool = COALESCE(platform_pool,0) + COALESCE(external_buffer_balance,0),
  lifetime_platform_earned = COALESCE(lifetime_platform_earned,0) + COALESCE(external_buffer_balance,0),
  updated_at = now()
WHERE id = 1;

-- 2) Drop the now-unified buffer columns
ALTER TABLE public.admin_treasury
  DROP COLUMN IF EXISTS external_buffer_balance,
  DROP COLUMN IF EXISTS lifetime_external_buffer_in,
  DROP COLUMN IF EXISTS lifetime_external_buffer_out;

-- 3) Drop the obsolete smart-buffer per-store columns
ALTER TABLE public.stores
  DROP COLUMN IF EXISTS ext_smart_target_pct,
  DROP COLUMN IF EXISTS ext_smart_min_pct,
  DROP COLUMN IF EXISTS ext_smart_max_pct;

-- 4) Migrate any store stuck on smart_buffer back to the default tiered model
UPDATE public.stores
SET ext_billing_mode = 'tiered'
WHERE ext_billing_mode = 'smart_buffer' OR ext_billing_mode IS NULL;

-- 5) Drop helper that's no longer used
DROP FUNCTION IF EXISTS public.compute_smart_buffer_charge(numeric, numeric, numeric, numeric, numeric, numeric);

-- 6) Helper: pick commission % from commission_tiers (same as internal orders)
CREATE OR REPLACE FUNCTION public.commission_pct_for_amount(p_amount numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT commission_pct
      FROM public.commission_tiers
      WHERE is_active = true
        AND p_amount >= min_amount
        AND (max_amount IS NULL OR p_amount < max_amount)
      ORDER BY min_amount DESC
      LIMIT 1
    ),
    15
  );
$$;

-- 7) Rewrite create_external_order: simple, mirrors internal commission tiers
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
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_pct numeric;
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
  v_pm text;
  v_mode text;
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

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  -- Driver payout (same rule as internal orders)
  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  v_mode := COALESCE(v_store.ext_billing_mode, 'tiered');

  -- Store charge — default uses commission_tiers (same as internal)
  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSIF v_mode = 'commission' THEN
    v_store_charge := ROUND((p_total_amount * COALESCE(v_store.ext_commission_pct,15) / 100)::numeric, 2);
  ELSIF v_mode = 'flat_fee' THEN
    v_store_charge := COALESCE(v_store.ext_flat_fee, 0);
  ELSIF v_mode = 'driver_plus_margin' THEN
    v_store_charge := ROUND((v_driver_pay * (1 + COALESCE(v_store.ext_margin_pct,0) / 100))::numeric, 2);
  ELSE
    -- 'tiered' (default): same commission tiers as internal orders
    v_pct := commission_pct_for_amount(p_total_amount);
    v_store_charge := ROUND((p_total_amount * v_pct / 100)::numeric, 2);
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END,
    CASE WHEN v_pm = 'cash' THEN '💶 ΜΕΤΡΗΤΑ — εισπράττει ο οδηγός' END
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

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' (' || v_pm || ') for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'payment_method', v_pm,
        'mode', v_mode,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;
