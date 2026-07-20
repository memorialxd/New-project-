CREATE OR REPLACE FUNCTION public.admin_reset_driver_wallet(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prev_available numeric;
  v_prev_pending numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reset driver wallet';
  END IF;

  SELECT available_balance, pending_balance
    INTO v_prev_available, v_prev_pending
  FROM public.driver_wallets
  WHERE driver_id = p_driver_id;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance)
  VALUES (p_driver_id, 0, 0)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = 0,
        pending_balance = 0,
        updated_at = now();

  -- Log a debit transaction so history reflects the reset
  IF COALESCE(v_prev_available, 0) > 0 OR COALESCE(v_prev_pending, 0) > 0 THEN
    INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (
      p_driver_id,
      'admin_debit',
      -1 * COALESCE(v_prev_available, 0) - COALESCE(v_prev_pending, 0),
      'completed',
      'Admin reset wallet to 0'
    );
  END IF;

  PERFORM public.log_admin_action(
    'reset_driver_wallet',
    'driver',
    p_driver_id::text,
    'Μηδένισε πορτοφόλι οδηγού',
    jsonb_build_object(
      'previous_available', COALESCE(v_prev_available, 0),
      'previous_pending', COALESCE(v_prev_pending, 0)
    )
  );
END;
$$;