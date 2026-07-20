
-- 1) Force-assign order to a driver
CREATE OR REPLACE FUNCTION public.admin_force_assign_order(
  p_order_id uuid, p_driver_id uuid, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'support')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.orders
     SET driver_id = p_driver_id,
         status    = CASE WHEN status IN ('pending','placed') THEN 'accepted'::order_status ELSE status END,
         updated_at= now()
   WHERE id = p_order_id;
  UPDATE public.pending_offers
     SET status='cancelled', responded_at=now()
   WHERE order_id = p_order_id AND status='pending';
  PERFORM public.log_admin_action(
    'force_assign_order','order',p_order_id::text,
    format('Ανάθεση σε οδηγό %s%s', p_driver_id, COALESCE(' — '||p_reason,'')),
    NULL);
END;$$;

-- 2) Extend a pending offer
CREATE OR REPLACE FUNCTION public.admin_extend_offer(
  p_offer_id uuid, p_extra_seconds int
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_new timestamptz;
BEGIN
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'support')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_extra_seconds <= 0 OR p_extra_seconds > 600 THEN
    RAISE EXCEPTION 'invalid_seconds';
  END IF;
  UPDATE public.pending_offers
     SET expires_at = GREATEST(expires_at, now()) + make_interval(secs => p_extra_seconds)
   WHERE id = p_offer_id AND status = 'pending'
   RETURNING expires_at INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'offer_not_pending'; END IF;
  PERFORM public.log_admin_action(
    'extend_offer','pending_offer',p_offer_id::text,
    format('+%s sec', p_extra_seconds), NULL);
  RETURN v_new;
END;$$;

-- 3) Pause driver offers (timed break)
CREATE OR REPLACE FUNCTION public.admin_pause_driver_offers(
  p_driver_id uuid, p_minutes int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'support')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_minutes < 0 OR p_minutes > 720 THEN RAISE EXCEPTION 'invalid_minutes'; END IF;
  INSERT INTO public.driver_state (driver_id, on_break, break_until, updated_at)
    VALUES (p_driver_id, p_minutes > 0, CASE WHEN p_minutes>0 THEN now()+make_interval(mins=>p_minutes) ELSE NULL END, now())
    ON CONFLICT (driver_id) DO UPDATE
      SET on_break = EXCLUDED.on_break,
          break_until = EXCLUDED.break_until,
          updated_at = now();
  PERFORM public.log_admin_action(
    CASE WHEN p_minutes>0 THEN 'pause_driver' ELSE 'resume_driver' END,
    'driver',p_driver_id::text,
    CASE WHEN p_minutes>0 THEN format('Pause %s min',p_minutes) ELSE 'Resume' END, NULL);
END;$$;

-- 4) Credit customer wallet (admin only)
CREATE OR REPLACE FUNCTION public.admin_credit_customer_wallet(
  p_customer_id uuid, p_amount numeric, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  IF p_amount <= 0 OR p_amount > 20 THEN RAISE EXCEPTION 'amount_out_of_range'; END IF;
  IF COALESCE(btrim(p_reason),'')='' THEN RAISE EXCEPTION 'reason_required'; END IF;

  INSERT INTO public.customer_wallets (user_id, balance, lifetime_credit)
    VALUES (p_customer_id, p_amount, p_amount)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = public.customer_wallets.balance + EXCLUDED.balance,
          lifetime_credit = public.customer_wallets.lifetime_credit + EXCLUDED.lifetime_credit,
          updated_at = now();

  INSERT INTO public.customer_wallet_ledger (user_id, amount, type, description)
    VALUES (p_customer_id, p_amount, 'admin_credit', p_reason);

  PERFORM public.log_admin_action(
    'credit_customer_wallet','customer',p_customer_id::text,
    format('+%s€ — %s', p_amount, p_reason), NULL);
END;$$;

-- 5) Global dispatch kill switch (via feature_flags key 'dispatch_enabled')
CREATE OR REPLACE FUNCTION public.admin_set_dispatch_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  INSERT INTO public.feature_flags (key, label, description, is_enabled, category)
    VALUES ('dispatch_enabled','Global Dispatch','Master switch για δημιουργία νέων προσφορών', p_enabled, 'orders')
    ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now();
  PERFORM public.log_admin_action(
    CASE WHEN p_enabled THEN 'resume_dispatch' ELSE 'kill_dispatch' END,
    'platform',NULL,
    CASE WHEN p_enabled THEN 'Dispatch resumed' ELSE 'Dispatch KILLED' END, NULL);
END;$$;

-- Grants: admin+support for the first three, admin-only for wallet & kill switch.
REVOKE ALL ON FUNCTION public.admin_force_assign_order(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_extend_offer(uuid,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_pause_driver_offers(uuid,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_credit_customer_wallet(uuid,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_dispatch_enabled(boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_force_assign_order(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_offer(uuid,int)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pause_driver_offers(uuid,int)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_customer_wallet(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_dispatch_enabled(boolean)      TO authenticated;
