
-- 1) PUBLIC CODES per role
CREATE SEQUENCE IF NOT EXISTS public.seq_code_customer START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_driver START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_store START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_support START 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_code_admin START 1;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_code text UNIQUE;

CREATE OR REPLACE FUNCTION public.assign_profile_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  seq text;
  n bigint;
BEGIN
  IF NEW.public_code IS NOT NULL THEN RETURN NEW; END IF;
  CASE NEW.role::text
    WHEN 'driver'   THEN prefix := 'DRV'; seq := 'seq_code_driver';
    WHEN 'store'    THEN prefix := 'STR'; seq := 'seq_code_store';
    WHEN 'support'  THEN prefix := 'SUP'; seq := 'seq_code_support';
    WHEN 'admin'    THEN prefix := 'ADM'; seq := 'seq_code_admin';
    ELSE                 prefix := 'CUS'; seq := 'seq_code_customer';
  END CASE;
  EXECUTE format('SELECT nextval(%L)', 'public.'||seq) INTO n;
  NEW.public_code := prefix || '-' || lpad(n::text, 5, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_profile_code_trigger ON public.profiles;
CREATE TRIGGER assign_profile_code_trigger
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.assign_profile_code();

-- Backfill existing profiles in stable order per role
DO $$
DECLARE r RECORD; prefix text; seq text; n bigint;
BEGIN
  FOR r IN SELECT id, role FROM public.profiles WHERE public_code IS NULL ORDER BY role, created_at, id LOOP
    CASE r.role::text
      WHEN 'driver'  THEN prefix := 'DRV'; seq := 'seq_code_driver';
      WHEN 'store'   THEN prefix := 'STR'; seq := 'seq_code_store';
      WHEN 'support' THEN prefix := 'SUP'; seq := 'seq_code_support';
      WHEN 'admin'   THEN prefix := 'ADM'; seq := 'seq_code_admin';
      ELSE                prefix := 'CUS'; seq := 'seq_code_customer';
    END CASE;
    EXECUTE format('SELECT nextval(%L)', 'public.'||seq) INTO n;
    UPDATE public.profiles SET public_code = prefix||'-'||lpad(n::text,5,'0') WHERE id = r.id;
  END LOOP;
END $$;

-- Also keep code stable if role changes later (do nothing — preserve original)

-- 2) MONEY BUFFER settings (reuse admin_treasury.platform_pool as the buffer)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS buffer_floor numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS buffer_auto_fill_pct numeric NOT NULL DEFAULT 10;

-- 3) Distribute buffer RPC: modes = equal | top | surge
CREATE OR REPLACE FUNCTION public.admin_distribute_buffer(
  p_amount numeric,
  p_mode text DEFAULT 'equal',     -- equal | top | surge
  p_top_n integer DEFAULT 10,
  p_zone_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor numeric;
  v_pool numeric;
  v_recipients uuid[];
  v_count integer;
  v_per numeric;
  v_dist_id uuid;
  v_drv uuid;
  v_zone_lat double precision;
  v_zone_lng double precision;
  v_zone_radius numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT buffer_floor INTO v_floor FROM platform_settings WHERE id=1;
  SELECT platform_pool INTO v_pool FROM admin_treasury WHERE id=1 FOR UPDATE;
  IF v_pool - p_amount < COALESCE(v_floor,0) THEN
    RAISE EXCEPTION 'distribution would breach buffer floor (pool=%, floor=%)', v_pool, v_floor;
  END IF;

  -- Pick recipients
  IF p_mode = 'top' THEN
    SELECT array_agg(driver_id) INTO v_recipients FROM (
      SELECT driver_id, sum(COALESCE(total,base_pay+COALESCE(tip,0)+COALESCE(bonus,0))) s
      FROM earnings WHERE created_at > now() - interval '7 days'
      GROUP BY driver_id ORDER BY s DESC LIMIT GREATEST(p_top_n,1)
    ) t;
  ELSIF p_mode = 'surge' THEN
    IF p_zone_id IS NULL THEN RAISE EXCEPTION 'zone_id required for surge mode'; END IF;
    SELECT latitude, longitude, radius_km INTO v_zone_lat, v_zone_lng, v_zone_radius
      FROM demand_zones WHERE id = p_zone_id;
    SELECT array_agg(DISTINCT dl.driver_id) INTO v_recipients
    FROM driver_locations dl
    JOIN driver_state ds ON ds.driver_id = dl.driver_id
    WHERE dl.updated_at > now() - interval '20 minutes'
      AND (6371 * acos(
        cos(radians(v_zone_lat)) * cos(radians(dl.latitude)) *
        cos(radians(dl.longitude) - radians(v_zone_lng)) +
        sin(radians(v_zone_lat)) * sin(radians(dl.latitude))
      )) <= COALESCE(v_zone_radius,1);
  ELSE
    -- equal: all drivers with shift active in last 24h or with earnings in last 7d
    SELECT array_agg(DISTINCT driver_id) INTO v_recipients FROM (
      SELECT driver_id FROM earnings WHERE created_at > now() - interval '7 days'
      UNION
      SELECT driver_id FROM driver_state WHERE shift_started_at IS NOT NULL AND shift_started_at > now() - interval '24 hours'
    ) t;
  END IF;

  v_count := COALESCE(array_length(v_recipients,1),0);
  IF v_count = 0 THEN RAISE EXCEPTION 'no eligible drivers'; END IF;
  v_per := round((p_amount / v_count)::numeric, 2);

  INSERT INTO basket_distributions(triggered_by, created_by, total_amount, recipient_count, basket_balance_before, basket_balance_after, notes, snapshot)
  VALUES ('manual', auth.uid(), v_per * v_count, v_count, v_pool, v_pool - (v_per*v_count), p_note,
          jsonb_build_object('mode',p_mode,'top_n',p_top_n,'zone_id',p_zone_id,'recipients',v_recipients))
  RETURNING id INTO v_dist_id;

  FOREACH v_drv IN ARRAY v_recipients LOOP
    INSERT INTO driver_wallets(driver_id, available_balance)
    VALUES (v_drv, v_per)
    ON CONFLICT (driver_id) DO UPDATE SET available_balance = driver_wallets.available_balance + v_per, updated_at = now();

    INSERT INTO wallet_transactions(driver_id, type, amount, status, description)
    VALUES (v_drv, 'bonus', v_per, 'completed', 'Buffer distribution ('||p_mode||')');

    INSERT INTO basket_distribution_payouts(distribution_id, driver_id, amount, reason)
    VALUES (v_dist_id, v_drv, v_per, p_mode);
  END LOOP;

  UPDATE admin_treasury SET platform_pool = platform_pool - (v_per * v_count), updated_at = now() WHERE id = 1;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
  VALUES ('buffer_distribute', 'platform_pool', -(v_per*v_count),
          'Distribute '||p_mode||' to '||v_count||' drivers ('||COALESCE(p_note,'')||')', auth.uid());

  INSERT INTO admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(),'distribute_buffer','distribution',v_dist_id::text,
          'Distributed €'||(v_per*v_count)||' to '||v_count||' drivers',
          jsonb_build_object('mode',p_mode,'per_driver',v_per,'recipients',v_count));

  RETURN jsonb_build_object('distribution_id',v_dist_id,'per_driver',v_per,'recipients',v_count,'total',v_per*v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_distribute_buffer(numeric,text,integer,uuid,text) TO authenticated;
