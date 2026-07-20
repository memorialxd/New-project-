
CREATE OR REPLACE FUNCTION public.admin_inject_pool(p_amount numeric, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
  uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can inject into the driver pool';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Amount must be non-zero';
  END IF;

  UPDATE public.admin_treasury
    SET platform_pool = platform_pool + p_amount,
        lifetime_driver_topup = lifetime_driver_topup + GREATEST(p_amount, 0),
        updated_at = now()
    WHERE id = 1
    RETURNING platform_pool INTO new_balance;

  INSERT INTO public.admin_treasury_ledger (amount, bag, type, description, created_by)
  VALUES (p_amount, 'platform',
          CASE WHEN p_amount > 0 THEN 'admin_topup' ELSE 'admin_withdraw' END,
          COALESCE(p_note,
            CASE WHEN p_amount > 0 THEN 'Admin manual driver pool top-up'
                 ELSE 'Admin manual driver pool withdrawal' END),
          uid);

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (uid,
          CASE WHEN p_amount > 0 THEN 'pool_topup' ELSE 'pool_withdraw' END,
          'platform_pool',
          COALESCE(p_note, 'Manual driver pool adjustment'),
          jsonb_build_object('amount', p_amount, 'new_balance', new_balance));

  RETURN jsonb_build_object('new_balance', new_balance, 'amount', p_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_inject_pool(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_inject_pool(numeric, text) TO authenticated;
