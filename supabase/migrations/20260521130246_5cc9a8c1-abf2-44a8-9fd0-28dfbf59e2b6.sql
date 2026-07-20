
-- ============================================================
-- 1) Stores: hide sensitive columns from generic authenticated users
-- ============================================================
DROP VIEW IF EXISTS public.stores_public;

DROP POLICY IF EXISTS "Authenticated users can view stores" ON public.stores;

CREATE POLICY "Owners view own store"
ON public.stores FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY "Drivers view stores for their active orders"
ON public.stores FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = stores.id
      AND o.driver_id = auth.uid()
      AND o.status = ANY (ARRAY['accepted','preparing','ready','arrived','picked_up']::order_status[])
  )
);

CREATE POLICY "Customers view stores for their active orders"
ON public.stores FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = stores.id
      AND o.customer_id = auth.uid()
  )
);

CREATE POLICY "Anyone reads active stores"
ON public.stores FOR SELECT
TO authenticated, anon
USING (is_active = true);

-- Column-level revoke: hide sensitive fields from REST clients (everyone is `authenticated`/`anon`)
REVOKE SELECT (commission_pct, ext_commission_pct, ext_billing_mode,
               ext_flat_fee, ext_margin_pct, suspension_reason, phone)
  ON public.stores FROM authenticated, anon;

GRANT SELECT (commission_pct, ext_commission_pct, ext_billing_mode,
              ext_flat_fee, ext_margin_pct, suspension_reason, phone)
  ON public.stores TO service_role;

-- Public-safe view used by browsing flows
CREATE VIEW public.stores_public
WITH (security_invoker = true) AS
SELECT
  id, owner_id, name, address, latitude, longitude, image_url,
  is_active, busy_mode, prep_buffer_minutes, opening_hours, holiday_dates,
  promotion_status, promotion_starts_at, promotion_ends_at,
  covers_delivery_fee, created_at, updated_at
FROM public.stores;

GRANT SELECT ON public.stores_public TO authenticated, anon;

-- SECURITY DEFINER function for legitimate access to phone/contact details
CREATE OR REPLACE FUNCTION public.get_store_contact(_store_id uuid)
RETURNS TABLE(id uuid, name text, address text, phone text,
              latitude double precision, longitude double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.address, s.phone, s.latitude, s.longitude
  FROM public.stores s
  WHERE s.id = _store_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_support_or_admin(auth.uid())
      OR s.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.store_id = s.id
          AND (o.driver_id = auth.uid() OR o.customer_id = auth.uid())
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_store_contact(uuid) TO authenticated;

-- ============================================================
-- 2) Storage: fix delivery proof bucket name
-- ============================================================
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;

CREATE POLICY "Store owners view their order proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND (storage.foldername(objects.name))[1] = (o.id)::text
  )
);

-- ============================================================
-- 3) Realtime: scope broadcast channels
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='realtime' AND tablename='messages' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON realtime.messages;', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users read own realtime topics"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE ('user:' || auth.uid()::text || '%'))
  OR is_support_or_admin(auth.uid())
);

CREATE POLICY "Users send to own realtime topics"
ON realtime.messages FOR INSERT
TO authenticated
WITH CHECK (
  (realtime.topic() LIKE ('user:' || auth.uid()::text || '%'))
  OR is_support_or_admin(auth.uid())
);

-- ============================================================
-- 4) Server-side place_order RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_order(
  p_store_id uuid,
  p_items jsonb,
  p_delivery_address text,
  p_delivery_latitude double precision,
  p_delivery_longitude double precision,
  p_payment_method text,
  p_tip_amount numeric,
  p_delivery_fee numeric,
  p_notes text,
  p_scheduled_for timestamptz,
  p_distance_km numeric,
  p_promo_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_promo record;
  v_order_id uuid;
  v_item jsonb;
  v_menu record;
  v_qty int;
  v_total numeric;
  v_fee numeric := COALESCE(p_delivery_fee, 0);
  v_tip numeric := GREATEST(COALESCE(p_tip_amount, 0), 0);
  v_status order_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;
  IF p_payment_method NOT IN ('cash','card') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price, mi.store_id, mi.is_available, mi.is_snoozed
      INTO v_menu
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item not found';
    END IF;
    IF v_menu.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Menu item does not belong to store';
    END IF;
    IF COALESCE(v_menu.is_available, true) = false OR COALESCE(v_menu.is_snoozed, false) = true THEN
      RAISE EXCEPTION 'Menu item unavailable: %', v_menu.name;
    END IF;
    v_subtotal := v_subtotal + (v_menu.price * v_qty);
  END LOOP;

  IF p_promo_code IS NOT NULL AND length(trim(p_promo_code)) > 0 THEN
    SELECT * INTO v_promo
      FROM public.promo_codes
      WHERE lower(code) = lower(trim(p_promo_code))
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR current_uses < max_uses)
        AND (store_id IS NULL OR store_id = p_store_id)
        AND min_order_amount <= v_subtotal
      LIMIT 1;
    IF FOUND THEN
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
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));
    SELECT mi.id, mi.name, mi.price INTO v_menu
      FROM public.menu_items mi
      WHERE mi.id = (v_item->>'menu_item_id')::uuid;
    INSERT INTO public.order_items (order_id, menu_item_id, name, quantity, unit_price)
    VALUES (v_order_id, v_menu.id, v_menu.name, v_qty, v_menu.price);
  END LOOP;

  IF v_promo.id IS NOT NULL THEN
    UPDATE public.promo_codes SET current_uses = current_uses + 1 WHERE id = v_promo.id;
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(
  uuid, jsonb, text, double precision, double precision,
  text, numeric, numeric, text, timestamptz, numeric, text
) TO authenticated;
