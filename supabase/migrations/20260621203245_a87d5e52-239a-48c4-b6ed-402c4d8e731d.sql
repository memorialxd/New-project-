ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_issued_by_month
  ON public.wallet_transactions (issued_by, created_at)
  WHERE type IN ('support_credit','admin_credit');

CREATE OR REPLACE FUNCTION public.support_credit_wallet(
  p_driver_id uuid, p_amount numeric, p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_is_support boolean := public.has_role(auth.uid(), 'support');
  v_max numeric;
  v_monthly_limit int;
  v_used int;
BEGIN
  IF NOT (v_is_admin OR v_is_support) THEN
    RAISE EXCEPTION 'Forbidden: only support or admin may credit wallets';
  END IF;

  v_max           := CASE WHEN v_is_admin THEN 20 ELSE 5 END;
  v_monthly_limit := CASE WHEN v_is_admin THEN 30 ELSE 5 END;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_max THEN
    RAISE EXCEPTION 'Amount must be between 0 and % EUR for your role', v_max;
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT count(*) INTO v_used
    FROM public.wallet_transactions
   WHERE issued_by = auth.uid()
     AND type IN ('support_credit','admin_credit')
     AND created_at >= date_trunc('month', now());

  IF v_used >= v_monthly_limit THEN
    RAISE EXCEPTION 'Monthly credit limit reached (%/%) for this month', v_used, v_monthly_limit;
  END IF;

  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
    ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET available_balance = available_balance + p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

  INSERT INTO public.wallet_transactions
    (driver_id, type, amount, status, description, issued_by)
  VALUES
    (p_driver_id,
     CASE WHEN v_is_admin THEN 'admin_credit' ELSE 'support_credit' END,
     p_amount, 'completed', p_reason, auth.uid());
END;
$$;