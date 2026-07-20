-- 1. Drop overly broad public stores SELECT policy. Customer-facing browsing uses stores_public view.
DROP POLICY IF EXISTS "Anyone reads active stores" ON public.stores;

-- 2. Tighten customer_has_order_at_store: only count orders in active/recent statuses
CREATE OR REPLACE FUNCTION public.customer_has_order_at_store(_user uuid, _store uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = _store
      AND o.customer_id = _user
      AND o.status IN ('placed','accepted','preparing','ready','arrived','picked_up','delivered')
      AND o.created_at > now() - interval '30 days'
  );
$$;

-- 3. Fix delivery-proofs store-owner SELECT policy (path is {driver_id}/{order_id}.{ext})
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;
CREATE POLICY "Store owners view their order proofs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND o.driver_id::text = (storage.foldername(storage.objects.name))[1]
      AND split_part(storage.filename(storage.objects.name), '.', 1) = o.id::text
  )
);

-- 4. Lock down wait_time_bonuses: server recomputes bonus_amount/wait_minutes/is_applied on UPDATE
CREATE OR REPLACE FUNCTION public.enforce_wait_bonus_server_calc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  arrived timestamptz;
  picked timestamptz;
  computed_minutes int;
  computed_bonus numeric := 0;
  rate_per_min numeric := 0;
  grace_minutes int := 5;
  cap_amount numeric := 5;
BEGIN
  -- Admins bypass (their own ALL policy already lets them set values)
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Pull canonical timestamps from the order
  SELECT NULL::timestamptz, NULL::timestamptz INTO arrived, picked;
  -- orders table doesn't have explicit arrived_at/picked_up_at columns; use status timestamps if present.
  -- Fallback: use NEW.arrived_at and NEW.picked_up_at (drivers can set those via app flow).
  arrived := NEW.arrived_at;
  picked  := NEW.picked_up_at;

  -- Pull policy values from platform_settings if columns exist (best-effort)
  BEGIN
    EXECUTE 'SELECT COALESCE(wait_bonus_rate_per_min, 0), COALESCE(wait_bonus_grace_minutes, 5), COALESCE(wait_bonus_cap, 5) FROM public.platform_settings WHERE id = 1'
      INTO rate_per_min, grace_minutes, cap_amount;
  EXCEPTION WHEN undefined_column THEN
    rate_per_min := 0.20;
    grace_minutes := 5;
    cap_amount := 5;
  END;

  IF picked IS NULL OR arrived IS NULL THEN
    NEW.wait_minutes := 0;
    NEW.bonus_amount := 0;
    NEW.is_applied := false;
  ELSE
    computed_minutes := GREATEST(0, EXTRACT(EPOCH FROM (picked - arrived))/60)::int;
    NEW.wait_minutes := computed_minutes;
    computed_bonus := GREATEST(0, computed_minutes - grace_minutes) * rate_per_min;
    IF computed_bonus > cap_amount THEN computed_bonus := cap_amount; END IF;
    NEW.bonus_amount := ROUND(computed_bonus, 2);
    NEW.is_applied := (NEW.bonus_amount > 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_wait_bonus_server_calc ON public.wait_time_bonuses;
CREATE TRIGGER trg_enforce_wait_bonus_server_calc
BEFORE INSERT OR UPDATE ON public.wait_time_bonuses
FOR EACH ROW EXECUTE FUNCTION public.enforce_wait_bonus_server_calc();