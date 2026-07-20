-- =========================================================================
-- PHASE 1: Unified Ledger Overlay + Surge Engine Foundation
-- =========================================================================

-- 1) TRANSACTIONS (overlay, immutable)
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_kind text NOT NULL CHECK (wallet_kind IN ('driver','store','customer','admin','basket')),
  wallet_owner_id uuid,
  amount numeric NOT NULL,
  type text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  surge_event_id uuid,
  balance_after numeric,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_owner_kind_created ON public.transactions(wallet_kind, wallet_owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_order ON public.transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_tx_created ON public.transactions(created_at DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all transactions"
  ON public.transactions FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Drivers view own tx"
  ON public.transactions FOR SELECT
  USING (wallet_kind = 'driver' AND wallet_owner_id = auth.uid());

CREATE POLICY "Customers view own tx"
  ON public.transactions FOR SELECT
  USING (wallet_kind = 'customer' AND wallet_owner_id = auth.uid());

CREATE POLICY "Store owners view own store tx"
  ON public.transactions FOR SELECT
  USING (wallet_kind = 'store' AND EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = transactions.wallet_owner_id AND s.owner_id = auth.uid()
  ));

-- No INSERT/UPDATE/DELETE policies => append-only via SECURITY DEFINER triggers only.

-- 2) SURGE EVENTS (history)
CREATE TABLE IF NOT EXISTS public.surge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.demand_zones(id) ON DELETE CASCADE,
  multiplier numeric NOT NULL DEFAULT 1.0,
  source text NOT NULL CHECK (source IN ('auto','manual','time','weather')),
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_surge_events_zone_active ON public.surge_events(zone_id, started_at DESC);
ALTER TABLE public.surge_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage surge events" ON public.surge_events FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Drivers view active surge" ON public.surge_events FOR SELECT
  USING (has_role(auth.uid(),'driver'::app_role) AND (ends_at IS NULL OR ends_at > now()));

-- 3) SURGE OVERRIDES (admin manual)
CREATE TABLE IF NOT EXISTS public.surge_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.demand_zones(id) ON DELETE CASCADE,
  multiplier numeric NOT NULL DEFAULT 1.0,
  mode text NOT NULL DEFAULT 'force' CHECK (mode IN ('force','freeze','disable')),
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_surge_overrides_zone_active ON public.surge_overrides(zone_id, is_active);
ALTER TABLE public.surge_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage surge overrides" ON public.surge_overrides FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 4) ORDERS: record what surge was applied
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS surge_multiplier_used numeric NOT NULL DEFAULT 1.0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS surge_event_id uuid;

-- 5) PLATFORM_SETTINGS: surge config
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS surge_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS surge_default_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS surge_time_peak_multiplier numeric NOT NULL DEFAULT 1.25,
  ADD COLUMN IF NOT EXISTS surge_ratio_low_threshold numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS surge_ratio_high_threshold numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS surge_ratio_high_multiplier numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS surge_ratio_extreme_multiplier numeric NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS surge_floor_multiplier numeric NOT NULL DEFAULT 0.8;

-- 6) RPC: current_surge_for_zone (manual override > time > zone ratio > default)
CREATE OR REPLACE FUNCTION public.current_surge_for_zone(_zone_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  ps RECORD;
  ov RECORD;
  z RECORD;
  ratio numeric;
  mult numeric;
  src text;
  reason text;
  hr int;
  dow int;
  in_peak boolean;
BEGIN
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;
  IF ps IS NULL OR NOT COALESCE(ps.surge_enabled, true) THEN
    RETURN jsonb_build_object('multiplier', 1.0, 'source', 'disabled', 'reason', 'surge disabled');
  END IF;

  -- 1) Manual override
  SELECT * INTO ov FROM public.surge_overrides
   WHERE zone_id = _zone_id AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF ov.mode = 'disable' THEN
      RETURN jsonb_build_object('multiplier', 1.0, 'source','manual','reason', COALESCE(ov.reason,'admin disabled'));
    END IF;
    RETURN jsonb_build_object('multiplier', ov.multiplier, 'source','manual','reason', COALESCE(ov.reason,'admin override'));
  END IF;

  mult := ps.surge_default_multiplier;
  src := 'default';
  reason := 'baseline';

  -- 2) Time window peak
  hr := EXTRACT(HOUR FROM now() AT TIME ZONE 'Europe/Athens')::int;
  dow := EXTRACT(ISODOW FROM now() AT TIME ZONE 'Europe/Athens')::int;
  in_peak := false;
  IF ps.peak_start_hour IS NOT NULL AND ps.peak_end_hour IS NOT NULL THEN
    IF dow = ANY(COALESCE(ps.peak_weekdays, ARRAY[1,2,3,4,5,6,7])) THEN
      IF ps.peak_start_hour <= ps.peak_end_hour THEN
        in_peak := hr >= ps.peak_start_hour AND hr < ps.peak_end_hour;
      ELSE
        in_peak := hr >= ps.peak_start_hour OR hr < ps.peak_end_hour;
      END IF;
    END IF;
  END IF;
  IF in_peak THEN
    mult := GREATEST(mult, ps.surge_time_peak_multiplier);
    src := 'time'; reason := 'peak hours';
  END IF;

  -- 3) Zone supply/demand ratio (orders/drivers)
  SELECT * INTO z FROM public.demand_zones WHERE id = _zone_id;
  IF FOUND AND z.driver_count > 0 THEN
    ratio := z.order_count::numeric / GREATEST(z.driver_count, 1);
    IF ratio >= ps.surge_ratio_high_threshold * 2 THEN
      mult := GREATEST(mult, ps.surge_ratio_extreme_multiplier);
      src := 'auto'; reason := format('extreme demand ratio %.2f', ratio);
    ELSIF ratio >= ps.surge_ratio_high_threshold THEN
      mult := GREATEST(mult, ps.surge_ratio_high_multiplier);
      src := 'auto'; reason := format('high demand ratio %.2f', ratio);
    ELSIF ratio < ps.surge_ratio_low_threshold THEN
      mult := LEAST(mult, GREATEST(ps.surge_floor_multiplier, 0.5));
      src := 'auto'; reason := format('low demand ratio %.2f', ratio);
    END IF;
  END IF;

  RETURN jsonb_build_object('multiplier', mult, 'source', src, 'reason', reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_surge_for_zone(uuid) TO authenticated;

-- 7) RPC: open_surge_event (admin convenience to start an event)
CREATE OR REPLACE FUNCTION public.open_surge_event(_zone_id uuid, _multiplier numeric, _source text, _reason text, _ends_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin only'; END IF;
  INSERT INTO public.surge_events (zone_id, multiplier, source, reason, ends_at, created_by)
  VALUES (_zone_id, _multiplier, _source, _reason, _ends_at, auth.uid())
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.open_surge_event(uuid,numeric,text,text,timestamptz) TO authenticated;

-- =========================================================================
-- LEDGER MIRROR TRIGGERS
-- =========================================================================

-- Append a row to transactions. SECURITY DEFINER so it bypasses missing INSERT policy.
CREATE OR REPLACE FUNCTION public.tx_append(
  _kind text, _owner uuid, _amount numeric, _type text,
  _order_id uuid, _balance_after numeric, _description text, _meta jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _amount IS NULL OR _amount = 0 THEN RETURN; END IF;
  INSERT INTO public.transactions (wallet_kind, wallet_owner_id, amount, type, order_id, balance_after, description, metadata)
  VALUES (_kind, _owner, _amount, _type, _order_id, _balance_after, _description, COALESCE(_meta,'{}'::jsonb));
END $$;

-- Driver wallets diff
CREATE OR REPLACE FUNCTION public.tx_mirror_driver_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.available_balance,0);
  ELSE
    delta := COALESCE(NEW.available_balance,0) - COALESCE(OLD.available_balance,0);
  END IF;
  IF delta <> 0 THEN
    PERFORM public.tx_append('driver', NEW.driver_id, delta,
      CASE WHEN delta > 0 THEN 'wallet_credit' ELSE 'wallet_debit' END,
      NULL, NEW.available_balance, 'driver_wallet sync');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_driver_wallet ON public.driver_wallets;
CREATE TRIGGER trg_tx_driver_wallet AFTER INSERT OR UPDATE OF available_balance ON public.driver_wallets
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_driver_wallet();

-- Store wallets diff
CREATE OR REPLACE FUNCTION public.tx_mirror_store_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.available_balance,0);
  ELSE
    delta := COALESCE(NEW.available_balance,0) - COALESCE(OLD.available_balance,0);
  END IF;
  IF delta <> 0 THEN
    PERFORM public.tx_append('store', NEW.store_id, delta,
      CASE WHEN delta > 0 THEN 'wallet_credit' ELSE 'wallet_debit' END,
      NULL, NEW.available_balance, 'store_wallet sync');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_store_wallet ON public.store_wallets;
CREATE TRIGGER trg_tx_store_wallet AFTER INSERT OR UPDATE OF available_balance ON public.store_wallets
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_store_wallet();

-- Customer wallets diff
CREATE OR REPLACE FUNCTION public.tx_mirror_customer_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.balance,0);
  ELSE
    delta := COALESCE(NEW.balance,0) - COALESCE(OLD.balance,0);
  END IF;
  IF delta <> 0 THEN
    PERFORM public.tx_append('customer', NEW.user_id, delta,
      CASE WHEN delta > 0 THEN 'wallet_credit' ELSE 'wallet_debit' END,
      NULL, NEW.balance, 'customer_wallet sync');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_customer_wallet ON public.customer_wallets;
CREATE TRIGGER trg_tx_customer_wallet AFTER INSERT OR UPDATE OF balance ON public.customer_wallets
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_customer_wallet();

-- Admin treasury ledger -> mirror to admin / basket transactions
CREATE OR REPLACE FUNCTION public.tx_mirror_treasury_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  kind text;
  bal numeric;
  t RECORD;
BEGIN
  -- 'admin' bag => admin wallet ; 'platform' bag => basket (driver pool)
  IF NEW.bag = 'admin' THEN kind := 'admin'; ELSE kind := 'basket'; END IF;
  SELECT admin_balance, platform_pool INTO t FROM public.admin_treasury WHERE id = 1;
  bal := CASE WHEN kind='admin' THEN t.admin_balance ELSE t.platform_pool END;
  PERFORM public.tx_append(kind, NULL, NEW.amount, NEW.type, NEW.order_id, bal,
    COALESCE(NEW.description, NEW.type), jsonb_build_object('treasury_ledger_id', NEW.id, 'bag', NEW.bag));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tx_treasury_ledger ON public.admin_treasury_ledger;
CREATE TRIGGER trg_tx_treasury_ledger AFTER INSERT ON public.admin_treasury_ledger
FOR EACH ROW EXECUTE FUNCTION public.tx_mirror_treasury_ledger();

-- =========================================================================
-- SETTLEMENT HOOK: stamp surge multiplier on order
-- =========================================================================
CREATE OR REPLACE FUNCTION public.stamp_order_surge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  zone RECORD;
  res jsonb;
BEGIN
  IF NEW.surge_multiplier_used IS NOT NULL AND NEW.surge_multiplier_used <> 1.0 THEN RETURN NEW; END IF;
  IF NEW.delivery_latitude IS NULL OR NEW.delivery_longitude IS NULL THEN RETURN NEW; END IF;
  -- Find nearest active zone within radius
  SELECT *, (
    6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(NEW.delivery_latitude)) * cos(radians(latitude)) *
      cos(radians(longitude) - radians(NEW.delivery_longitude)) +
      sin(radians(NEW.delivery_latitude)) * sin(radians(latitude))
    )))
  ) AS dist_km
  INTO zone
  FROM public.demand_zones
  WHERE is_active = true
  ORDER BY dist_km ASC LIMIT 1;
  IF zone.id IS NOT NULL AND zone.dist_km <= COALESCE(zone.radius_km, 1.0) THEN
    res := public.current_surge_for_zone(zone.id);
    NEW.surge_multiplier_used := COALESCE((res->>'multiplier')::numeric, 1.0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_order_surge ON public.orders;
CREATE TRIGGER trg_stamp_order_surge BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.stamp_order_surge();
