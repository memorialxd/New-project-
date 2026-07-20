
CREATE OR REPLACE FUNCTION public.admin_reset_store_lifetime(p_store_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store lifetime';
  END IF;
  SELECT lifetime_earnings INTO v_before FROM store_wallets WHERE store_id = p_store_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Store wallet not found'; END IF;
  UPDATE store_wallets SET lifetime_earnings = 0, updated_at = now() WHERE store_id = p_store_id;
  PERFORM log_admin_action('reset_store_lifetime', 'store', p_store_id::text,
    'Lifetime earnings reset from ' || v_before || '€ to 0', '{}'::jsonb);
  RETURN v_before;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_store_lifetime()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store lifetime';
  END IF;
  UPDATE store_wallets SET lifetime_earnings = 0, updated_at = now() WHERE lifetime_earnings <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM log_admin_action('reset_all_store_lifetime', 'store', NULL,
    'Bulk reset lifetime for ' || v_count || ' stores', '{}'::jsonb);
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_driver_lifetime(p_driver_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset driver lifetime';
  END IF;
  SELECT COALESCE(total_withdrawn, 0) INTO v_before FROM driver_wallets WHERE driver_id = p_driver_id;
  UPDATE driver_wallets SET total_withdrawn = 0, updated_at = now() WHERE driver_id = p_driver_id;
  PERFORM log_admin_action('reset_driver_lifetime', 'driver', p_driver_id::text,
    'Lifetime totals reset (was withdrawn=' || v_before || '€)', '{}'::jsonb);
  RETURN v_before;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_driver_lifetime()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset driver lifetime';
  END IF;
  UPDATE driver_wallets SET total_withdrawn = 0, updated_at = now() WHERE total_withdrawn <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM log_admin_action('reset_all_driver_lifetime', 'driver', NULL,
    'Bulk reset lifetime for ' || v_count || ' drivers', '{}'::jsonb);
  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_reset_store_lifetime(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_store_lifetime() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_driver_lifetime(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_driver_lifetime() TO authenticated;
