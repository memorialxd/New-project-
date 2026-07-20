-- ============================================================
-- SUPPORT: cancel & modify orders
-- (creating handled via existing create_external_order which
-- already authorizes is_support_or_admin)
-- ============================================================

-- 1. Cancel an order (refund driver fair-pay reversal if delivered? NO —
--    cancel only allowed if NOT yet delivered; reverse settlement is too risky.)
CREATE OR REPLACE FUNCTION public.support_cancel_order(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support or admin can cancel orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.status = 'delivered' THEN
    RAISE EXCEPTION 'Cannot cancel a delivered order — issue a refund instead';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled';
  END IF;

  UPDATE orders
    SET status = 'cancelled',
        notes = CASE
          WHEN p_reason IS NOT NULL AND p_reason <> ''
            THEN COALESCE(notes || E'\n', '') || '❌ Cancelled by support: ' || p_reason
          ELSE notes
        END,
        updated_at = now()
    WHERE id = p_order_id;

  -- Audit (admin-only audit log helper safely no-ops for support since
  -- log_admin_action requires admin; wrap in IF)
  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'cancel_order', 'order', p_order_id::text,
      'Cancelled order: ' || COALESCE(p_reason, 'no reason'),
      jsonb_build_object('reason', p_reason)
    );
  END IF;
END;
$$;

-- 2. Modify an order's editable fields
--    Allowed fields: total_amount, delivery_fee, tip_amount, delivery_address,
--    delivery_lat/lng, notes. Forbidden: store_id, customer_id, driver_id,
--    status (use dedicated RPCs for those).
CREATE OR REPLACE FUNCTION public.support_modify_order(
  p_order_id uuid,
  p_total_amount numeric DEFAULT NULL,
  p_delivery_fee numeric DEFAULT NULL,
  p_tip_amount numeric DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_change_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support or admin can modify orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot modify a % order', v_order.status;
  END IF;

  IF p_total_amount IS NOT NULL AND p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;
  IF p_delivery_fee IS NOT NULL AND p_delivery_fee < 0 THEN
    RAISE EXCEPTION 'Delivery fee cannot be negative';
  END IF;
  IF p_tip_amount IS NOT NULL AND p_tip_amount < 0 THEN
    RAISE EXCEPTION 'Tip cannot be negative';
  END IF;

  UPDATE orders SET
    total_amount      = COALESCE(p_total_amount,      total_amount),
    delivery_fee      = COALESCE(p_delivery_fee,      delivery_fee),
    tip_amount        = COALESCE(p_tip_amount,        tip_amount),
    delivery_address  = COALESCE(p_delivery_address,  delivery_address),
    delivery_latitude  = COALESCE(p_delivery_lat,     delivery_latitude),
    delivery_longitude = COALESCE(p_delivery_lng,     delivery_longitude),
    notes = CASE
      WHEN p_change_reason IS NOT NULL AND p_change_reason <> ''
        THEN COALESCE(notes || E'\n', '') || '✏️ Modified by support: ' || p_change_reason
      WHEN p_notes IS NOT NULL THEN p_notes
      ELSE notes
    END,
    updated_at = now()
  WHERE id = p_order_id;

  v_changes := jsonb_build_object(
    'total_amount', p_total_amount,
    'delivery_fee', p_delivery_fee,
    'tip_amount', p_tip_amount,
    'delivery_address', p_delivery_address,
    'reason', p_change_reason
  );

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'modify_order', 'order', p_order_id::text,
      'Modified order' || COALESCE(' — ' || p_change_reason, ''),
      v_changes
    );
  END IF;
END;
$$;

-- protect_order_financials trigger blocks non-admin financial edits;
-- our SECURITY DEFINER RPCs run as owner so they bypass that check —
-- which is the intended behaviour for support cancellations/modifications.