CREATE OR REPLACE FUNCTION public.admin_adjust_admin_buffer(
  p_amount numeric,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_delta numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT admin_balance INTO v_before FROM admin_treasury WHERE id = 1 FOR UPDATE;

  IF p_action = 'add' THEN
    v_after := v_before + p_amount;
  ELSIF p_action = 'remove' THEN
    v_after := GREATEST(0, v_before - p_amount);
  ELSIF p_action = 'set' THEN
    v_after := GREATEST(0, p_amount);
  ELSE
    RAISE EXCEPTION 'invalid action';
  END IF;

  v_delta := v_after - v_before;

  UPDATE admin_treasury SET admin_balance = v_after, updated_at = now() WHERE id = 1;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
  VALUES ('manual_adjust', 'admin', v_delta, COALESCE(p_reason, p_action), auth.uid());

  RETURN jsonb_build_object('before', v_before, 'after', v_after, 'delta', v_delta);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_admin_buffer(numeric, text, text) TO authenticated;