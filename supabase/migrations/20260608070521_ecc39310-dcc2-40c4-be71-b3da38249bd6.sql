
CREATE OR REPLACE FUNCTION public.admin_force_end_driver_shift(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  UPDATE public.driver_states
     SET shift_started_at = NULL,
         on_break = false,
         break_started_at = NULL
   WHERE driver_id = p_driver_id;
END;
$$;

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

  INSERT INTO public.driver_wallet_transactions (driver_id, amount, kind, note, created_by)
  VALUES (p_driver_id, p_amount, 'admin_bonus', COALESCE(p_note, 'Admin bonus'), auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_end_driver_shift(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_driver_bonus(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_end_driver_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_driver_bonus(uuid, numeric, text) TO authenticated;
