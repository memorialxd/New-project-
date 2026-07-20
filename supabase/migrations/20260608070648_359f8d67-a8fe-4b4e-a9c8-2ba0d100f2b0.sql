
CREATE OR REPLACE FUNCTION public.admin_grant_driver_bonus(
  p_driver_id uuid,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, lifetime_earned)
  VALUES (p_driver_id, p_amount, 0, p_amount)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = public.driver_wallets.available_balance + EXCLUDED.available_balance,
        lifetime_earned   = public.driver_wallets.lifetime_earned   + EXCLUDED.lifetime_earned,
        updated_at = now();
END;
$$;
