CREATE OR REPLACE FUNCTION public.admin_reset_driver_cash(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reset driver cash';
  END IF;

  INSERT INTO public.driver_state (driver_id, shift_cash_balance, shift_started_at)
  VALUES (p_driver_id, 0, now())
  ON CONFLICT (driver_id) DO UPDATE
    SET shift_cash_balance = 0,
        shift_started_at = now(),
        updated_at = now();

  PERFORM public.log_admin_action(
    'reset_driver_cash',
    'driver',
    p_driver_id::text,
    'Μηδένισε ταμείο βάρδιας οδηγού',
    '{}'::jsonb
  );
END;
$$;