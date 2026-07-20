CREATE OR REPLACE FUNCTION public.bump_driver_shift_cash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.amount_owed > 0 AND NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.driver_state (driver_id, shift_cash_balance, shift_started_at)
    VALUES (NEW.driver_id, NEW.amount_owed, COALESCE((SELECT shift_started_at FROM public.driver_state WHERE driver_id = NEW.driver_id), now()))
    ON CONFLICT (driver_id) DO UPDATE
      SET shift_cash_balance = public.driver_state.shift_cash_balance + NEW.amount_owed,
          shift_started_at = COALESCE(public.driver_state.shift_started_at, now()),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_driver_shift_cash_on_debt ON public.driver_cash_debts;
CREATE TRIGGER bump_driver_shift_cash_on_debt
AFTER INSERT ON public.driver_cash_debts
FOR EACH ROW
EXECUTE FUNCTION public.bump_driver_shift_cash();