-- Suspend a driver
CREATE OR REPLACE FUNCTION public.admin_suspend_driver(p_driver_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.driver_profiles
    SET suspended_at = now(),
        suspension_reason = COALESCE(p_reason, suspension_reason),
        is_active = false,
        updated_at = now()
    WHERE user_id = p_driver_id;

  UPDATE public.driver_state
    SET shift_started_at = NULL,
        on_break = false,
        break_started_at = NULL,
        updated_at = now()
    WHERE driver_id = p_driver_id;
END;
$$;

-- Unsuspend
CREATE OR REPLACE FUNCTION public.admin_unsuspend_driver(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.driver_profiles
    SET suspended_at = NULL,
        suspension_reason = NULL,
        is_active = true,
        updated_at = now()
    WHERE user_id = p_driver_id;
END;
$$;

-- Adjust driver wallet by signed amount
CREATE OR REPLACE FUNCTION public.admin_adjust_driver_wallet(p_driver_id uuid, p_amount numeric, p_note text DEFAULT 'Admin adjustment')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_bal numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'Amount required'; END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
  VALUES (p_driver_id, GREATEST(p_amount, 0), 0, 0)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = GREATEST(public.driver_wallets.available_balance + p_amount, 0),
        updated_at = now()
  RETURNING available_balance INTO new_bal;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id, CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END,
          p_amount, 'completed', COALESCE(p_note, 'Admin adjustment'));

  RETURN new_bal;
END;
$$;

-- Clear all unresolved cash debts
CREATE OR REPLACE FUNCTION public.admin_clear_driver_cash_debt(p_driver_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleared int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.driver_cash_debts
    SET settled = true,
        settled_at = now(),
        settled_by = auth.uid()
    WHERE driver_id = p_driver_id AND settled = false;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END;
$$;

-- Send a direct message to a driver
CREATE OR REPLACE FUNCTION public.admin_send_driver_message(p_driver_id uuid, p_title text, p_body text, p_severity text DEFAULT 'info')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  INSERT INTO public.driver_notifications (driver_id, title, body, severity, sender_id)
  VALUES (p_driver_id, COALESCE(p_title,'Μήνυμα'), COALESCE(p_body,''), COALESCE(p_severity,'info'), auth.uid())
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Force order status (admin god-mode)
CREATE OR REPLACE FUNCTION public.admin_force_order_status(p_order_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.orders SET status = p_status::order_status, updated_at = now() WHERE id = p_order_id;
END;
$$;

-- Partial / full refund
CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_amount numeric, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  UPDATE public.orders
    SET refunded_amount = COALESCE(refunded_amount,0) + p_amount,
        refund_reason = COALESCE(p_reason, refund_reason),
        updated_at = now()
    WHERE id = p_order_id;

  -- Credit customer wallet
  IF o.customer_id IS NOT NULL THEN
    INSERT INTO public.customer_wallets (customer_id, balance, lifetime_credit)
    VALUES (o.customer_id, p_amount, p_amount)
    ON CONFLICT (customer_id) DO UPDATE
      SET balance = public.customer_wallets.balance + p_amount,
          lifetime_credit = public.customer_wallets.lifetime_credit + p_amount,
          updated_at = now();

    INSERT INTO public.customer_wallet_ledger (customer_id, amount, type, description, order_id)
    VALUES (o.customer_id, p_amount, 'refund', COALESCE(p_reason,'Refund'), p_order_id);
  END IF;

  INSERT INTO public.refunds (order_id, amount, reason, status, processed_by, processed_at)
  VALUES (p_order_id, p_amount, p_reason, 'completed', auth.uid(), now());
END;
$$;