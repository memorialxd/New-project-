CREATE OR REPLACE FUNCTION public.admin_adjust_buffer(
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

  SELECT platform_pool INTO v_before FROM admin_treasury WHERE id = 1 FOR UPDATE;

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

  -- Write audited ledger entry FIRST so the basket guard trigger sees it
  -- (guard looks for bag='platform' with amount<0 in the last 5 seconds).
  IF v_delta <> 0 THEN
    INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
    VALUES ('manual_adjust', 'platform', v_delta, COALESCE(p_reason, p_action), auth.uid());
  END IF;

  UPDATE admin_treasury SET platform_pool = v_after, updated_at = now() WHERE id = 1;

  RETURN jsonb_build_object('before', v_before, 'after', v_after, 'delta', v_delta);
END;
$$;