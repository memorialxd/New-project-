
-- 1. Driver notifications table
CREATE TABLE public.driver_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  sender_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers read own notifications"
  ON public.driver_notifications FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "Drivers mark own notifications read"
  ON public.driver_notifications FOR UPDATE
  USING (auth.uid() = driver_id);

CREATE POLICY "Support/admin send notifications"
  ON public.driver_notifications FOR INSERT
  WITH CHECK (public.is_support_or_admin(auth.uid()));

CREATE POLICY "Support/admin view notifications"
  ON public.driver_notifications FOR SELECT
  USING (public.is_support_or_admin(auth.uid()));

CREATE INDEX idx_driver_notifications_driver_unread
  ON public.driver_notifications(driver_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_notifications;

-- 2. RPC: support_credit_wallet (capped €20)
CREATE OR REPLACE FUNCTION public.support_credit_wallet(
  p_driver_id uuid,
  p_amount numeric,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount <= 0 OR p_amount > 20 THEN
    RAISE EXCEPTION 'Amount must be between 0 and 20';
  END IF;

  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
    ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET available_balance = available_balance + p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (p_driver_id, 'support_credit', p_amount, 'completed', COALESCE(p_reason, 'Support credit'));
END;
$$;

-- 3. RPC: support_grant_bonus (capped €10)
CREATE OR REPLACE FUNCTION public.support_grant_bonus(
  p_driver_id uuid,
  p_amount numeric,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount <= 0 OR p_amount > 10 THEN
    RAISE EXCEPTION 'Bonus must be between 0 and 10';
  END IF;

  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
    ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET available_balance = available_balance + p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (p_driver_id, 'support_bonus', p_amount, 'completed', COALESCE(p_reason, 'Support bonus'));
END;
$$;

-- 4. RPC: support_suspend_driver (bypasses admin-only trigger via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.support_suspend_driver(
  p_driver_id uuid,
  p_reason text,
  p_suspend boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.driver_profiles
    SET is_active = NOT p_suspend,
        suspended_at = CASE WHEN p_suspend THEN now() ELSE NULL END,
        suspension_reason = CASE WHEN p_suspend THEN COALESCE(p_reason, 'Suspended by support') ELSE NULL END,
        updated_at = now()
    WHERE user_id = p_driver_id;
END;
$$;

-- 5. RPC: support_unassign_order (return to dispatch)
CREATE OR REPLACE FUNCTION public.support_unassign_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.orders
    SET driver_id = NULL,
        status = 'ready',
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;
