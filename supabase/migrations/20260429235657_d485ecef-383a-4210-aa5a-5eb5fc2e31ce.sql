
CREATE OR REPLACE FUNCTION public.driver_release_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.driver_id IS NULL OR v_order.driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'You are not assigned to this order';
  END IF;

  IF v_order.status::text IN ('picked_up','delivered','canceled','cancelled') THEN
    RAISE EXCEPTION 'Order can no longer be released';
  END IF;

  -- Record release so this driver is excluded from the next wave for this order
  INSERT INTO public.driver_offer_events (driver_id, order_id, action)
  VALUES (auth.uid(), p_order_id, 'released');

  -- Cancel any of this driver's pending offers for this order
  UPDATE public.pending_offers
     SET status = 'released', responded_at = now()
   WHERE order_id = p_order_id
     AND driver_id = auth.uid()
     AND status = 'pending';

  -- Release the order back to the pool and request immediate re-dispatch
  UPDATE public.orders
     SET driver_id = NULL,
         status = CASE
                    WHEN status::text IN ('accepted','arrived') THEN 'placed'::order_status
                    ELSE status
                  END,
         dispatch_at = now(),
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_release_order(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.driver_release_order(uuid) TO authenticated;
