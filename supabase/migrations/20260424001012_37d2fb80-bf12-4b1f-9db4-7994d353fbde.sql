-- Per-store billing configuration for external/manual orders
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS ext_billing_mode text NOT NULL DEFAULT 'commission',
  ADD COLUMN IF NOT EXISTS ext_commission_pct numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ext_flat_fee numeric NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS ext_margin_pct numeric NOT NULL DEFAULT 20;

-- Validate billing mode values via trigger (CHECK constraints would be inflexible)
CREATE OR REPLACE FUNCTION public.validate_store_billing_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ext_billing_mode NOT IN ('commission','flat_fee','driver_plus_margin') THEN
    RAISE EXCEPTION 'Invalid ext_billing_mode: %', NEW.ext_billing_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_store_billing_mode_trg ON public.stores;
CREATE TRIGGER validate_store_billing_mode_trg
BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.validate_store_billing_mode();

-- Track where each order came from + financial breakdown
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS external_ref text,
  ADD COLUMN IF NOT EXISTS store_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_payout numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_profit numeric NOT NULL DEFAULT 0;

-- Validate source via trigger
CREATE OR REPLACE FUNCTION public.validate_order_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source NOT IN ('in_app','manual','efood','wolt','box','other') THEN
    RAISE EXCEPTION 'Invalid order source: %', NEW.source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_order_source_trg ON public.orders;
CREATE TRIGGER validate_order_source_trg
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_order_source();

-- RPC: create an external/manual order with full pricing breakdown
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
  p_items_summary text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_order_id uuid;
  v_combined_notes text;
BEGIN
  IF NOT is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admin or support can create external orders';
  END IF;
  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  -- Driver pay: override if provided, otherwise apply rules
  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  -- Store charge: override or compute from billing mode
  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSE
    CASE v_store.ext_billing_mode
      WHEN 'commission'         THEN v_store_charge := ROUND((p_total_amount * v_store.ext_commission_pct / 100)::numeric, 2);
      WHEN 'flat_fee'           THEN v_store_charge := v_store.ext_flat_fee;
      WHEN 'driver_plus_margin' THEN v_store_charge := ROUND((v_driver_pay * (1 + v_store.ext_margin_pct / 100))::numeric, 2);
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name IS NOT NULL THEN '👤 ' || p_customer_name END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary IS NOT NULL THEN '🧾 ' || p_items_summary END
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
    v_combined_notes, 'external',
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  -- Insert one summary line item so totals show in the queue
  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  -- Audit (admins only — support skips the admin-only audit log)
  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$$;