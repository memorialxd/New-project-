-- Source: 20260429235134_e02b8837-f0fa-4dbc-93a5-bd5354596d13.sql

-- Fix 1: Replace unsafe substring-match join on store delivery proof access with
-- a deterministic order_id lookup based on the actual file path convention
-- ({driver_id}/{order_id}.{ext}).
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;

CREATE POLICY "Store owners view their order proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND o.id::text = split_part(
        (storage.foldername(name))[2],
        '.',
        1
      )
  )
);

-- Fix 2: Tighten user_roles INSERT/UPDATE/DELETE so privilege escalation is impossible
-- even if a permissive policy is added later. The existing permissive "Admins can manage roles"
-- ALL policy is replaced with explicit per-command policies that always require admin via
-- both USING and WITH CHECK clauses.
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Admins insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));


-- Source: 20260429235657_d485ecef-383a-4210-aa5a-5eb5fc2e31ce.sql

CREATE OR REPLACE FUNCTION public.driver_release_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.driver_id IS NULL OR v_order.driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'You are not assigned to this order';
  END IF;

  IF v_order.status::text IN ('picked_up','delivered','canceled','cancelled') THEN
    RAISE EXCEPTION 'Order can no longer be released';
  END IF;

  -- Record release so this driver is excluded from the next wave for this order
  INSERT INTO public.driver_offer_events (driver_id, order_id, action)
  VALUES (auth.uid(), p_order_id, 'released');

  -- Cancel any of this driver's pending offers for this order
  UPDATE public.pending_offers
     SET status = 'released', responded_at = now()
   WHERE order_id = p_order_id
     AND driver_id = auth.uid()
     AND status = 'pending';

  -- Release the order back to the pool and request immediate re-dispatch
  UPDATE public.orders
     SET driver_id = NULL,
         status = CASE
                    WHEN status::text IN ('accepted','arrived') THEN 'placed'::order_status
                    ELSE status
                  END,
         dispatch_at = now(),
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_release_order(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.driver_release_order(uuid) TO authenticated;


-- Source: 20260430011058_c3431fa8-549f-4bd6-9224-932db9ccb4c9.sql
-- 1. Settings: ensure floors are present
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS driver_pool_pct_of_subtotal numeric NOT NULL DEFAULT 10;

UPDATE public.platform_settings
  SET admin_share_pct = GREATEST(COALESCE(admin_share_pct, 0), 5),
      driver_pool_pct_of_subtotal = GREATEST(COALESCE(driver_pool_pct_of_subtotal, 0), 10),
      default_commission_pct = GREATEST(COALESCE(default_commission_pct, 0), 15)
  WHERE id = 1;

-- Floor trigger on settings
CREATE OR REPLACE FUNCTION public.enforce_commission_floors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.admin_share_pct < 5 THEN NEW.admin_share_pct := 5; END IF;
  IF NEW.driver_pool_pct_of_subtotal < 10 THEN NEW.driver_pool_pct_of_subtotal := 10; END IF;
  IF NEW.default_commission_pct < (NEW.admin_share_pct + NEW.driver_pool_pct_of_subtotal) THEN
    NEW.default_commission_pct := NEW.admin_share_pct + NEW.driver_pool_pct_of_subtotal;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_commission_floors ON public.platform_settings;
CREATE TRIGGER trg_enforce_commission_floors
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_commission_floors();

-- Per-store floor: commission_pct cannot drop below 15
CREATE OR REPLACE FUNCTION public.enforce_store_commission_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.commission_pct IS NOT NULL AND NEW.commission_pct < 15 THEN
    NEW.commission_pct := 15;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_store_commission_floor ON public.stores;
CREATE TRIGGER trg_enforce_store_commission_floor
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.enforce_store_commission_floor();

-- 2. Stores: covers_delivery_fee toggle
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS covers_delivery_fee boolean NOT NULL DEFAULT false;

-- 3. Track whether an order has been settled (to keep the trigger idempotent)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS commission_settled_at timestamp with time zone;

-- 4. Compute helper
CREATE OR REPLACE FUNCTION public.compute_order_split(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders%ROWTYPE;
  s public.stores%ROWTYPE;
  ps public.platform_settings%ROWTYPE;
  food_subtotal numeric;
  total_comm_pct numeric;
  admin_pct numeric;
  pool_pct numeric;
  store_extra_pct numeric;
  delivery_fee numeric;
  store_pays_delivery boolean;
  res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.stores WHERE id = o.store_id;
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;

  delivery_fee := COALESCE(o.delivery_fee, 0);
  food_subtotal := GREATEST(COALESCE(o.total_amount, 0) - delivery_fee - COALESCE(o.tip_amount, 0), 0);

  total_comm_pct := GREATEST(COALESCE(s.commission_pct, ps.default_commission_pct, 15), 15);
  admin_pct := GREATEST(COALESCE(ps.admin_share_pct, 5), 5);
  pool_pct := GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10);
  store_extra_pct := GREATEST(total_comm_pct - admin_pct - pool_pct, 0);

  store_pays_delivery := COALESCE(s.covers_delivery_fee, false);

  res := jsonb_build_object(
    'food_subtotal', food_subtotal,
    'delivery_fee', delivery_fee,
    'tip_amount', COALESCE(o.tip_amount, 0),
    'total_commission_pct', total_comm_pct,
    'admin_pct', admin_pct,
    'driver_pool_pct', pool_pct,
    'store_extra_commission_pct', store_extra_pct,
    'admin_amount', round(food_subtotal * admin_pct / 100, 2),
    'driver_pool_amount', round(food_subtotal * pool_pct / 100, 2),
    'store_extra_commission', round(food_subtotal * store_extra_pct / 100, 2),
    'store_keeps', round(food_subtotal * (100 - total_comm_pct) / 100, 2),
    'store_pays_delivery', store_pays_delivery,
    'driver_delivery_fee', delivery_fee,
    'driver_tip', COALESCE(o.tip_amount, 0)
  );
  RETURN res;
END;
$$;

-- 5. Settle trigger
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  store_extra numeric;
  pays_delivery boolean;
BEGIN
  -- Only settle on transition to delivered, once
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  admin_amt    := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt     := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  store_extra  := COALESCE((split->>'store_extra_commission')::numeric, 0);
  pays_delivery := COALESCE((split->>'store_pays_delivery')::boolean, false);

  -- Admin bag
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share of food subtotal');

    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Driver pool
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up share');

    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Extra store commission (if store has commission_pct > 15) -> platform pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Extra store commission above 15%');

    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- Pay delivery fee to driver (cash orders are settled separately via driver_cash_debts)
  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND COALESCE(NEW.payment_method, 'card') <> 'cash' THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  -- Persist
  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt + pool_amt + store_extra;
  NEW.driver_payout := delivery_amt;
  NEW.store_charge := admin_amt + pool_amt + store_extra + (CASE WHEN pays_delivery THEN delivery_amt ELSE 0 END);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_order_commission ON public.orders;
CREATE TRIGGER trg_settle_order_commission
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.settle_order_commission();

-- 6. Ensure unique driver_id on driver_wallets so the ON CONFLICT works
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='driver_wallets_driver_id_key'
  ) THEN
    ALTER TABLE public.driver_wallets ADD CONSTRAINT driver_wallets_driver_id_key UNIQUE (driver_id);
  END IF;
END $$;

-- Source: 20260501020431_a645557d-5385-41a9-9724-eb5606025b8c.sql
-- 1) Fix bug in admin_reset_money_to_zero: store_wallets uses available_balance, not balance
CREATE OR REPLACE FUNCTION public.admin_reset_money_to_zero()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_admin_bal numeric;
  v_platform_bal numeric;
  v_store_total numeric;
  v_driver_avail numeric;
  v_driver_pending numeric;
  v_driver_cash numeric;
  v_unsettled_debts numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset money';
  END IF;

  SELECT COALESCE(admin_balance, 0), COALESCE(platform_pool, 0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(available_balance), 0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance), 0), COALESCE(SUM(pending_balance), 0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance), 0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed), 0) INTO v_unsettled_debts
    FROM driver_cash_debts WHERE settled = false;

  v_snapshot := jsonb_build_object(
    'reset_at', now(),
    'reset_by', auth.uid(),
    'admin_balance_before', v_admin_bal,
    'platform_pool_before', v_platform_bal,
    'store_wallets_total_before', v_store_total,
    'driver_available_total_before', v_driver_avail,
    'driver_pending_total_before', v_driver_pending,
    'driver_shift_cash_total_before', v_driver_cash,
    'unsettled_cash_debts_before', v_unsettled_debts
  );

  UPDATE admin_treasury SET admin_balance = 0, platform_pool = 0, updated_at = now() WHERE id = 1;
  UPDATE store_wallets SET available_balance = 0, updated_at = now();
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0, updated_at = now();
  UPDATE driver_state SET shift_cash_balance = 0, updated_at = now();
  UPDATE driver_cash_debts SET settled = true, settled_at = now(), settled_by = auth.uid()
    WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system', 'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$function$;

-- 2) Per-bag reset functions
CREATE OR REPLACE FUNCTION public.admin_reset_admin_bag()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset bags';
  END IF;
  SELECT admin_balance INTO v_before FROM admin_treasury WHERE id = 1;
  UPDATE admin_treasury SET admin_balance = 0, updated_at = now() WHERE id = 1;
  INSERT INTO admin_treasury_ledger (type, bag, amount, description)
  VALUES ('manual_reset', 'admin', -COALESCE(v_before, 0),
          'Admin bag reset to 0 (was ' || COALESCE(v_before,0) || '€)');
  PERFORM log_admin_action('reset_admin_bag', 'treasury', 'admin',
    'Reset admin bag from ' || COALESCE(v_before,0) || '€ to 0', '{}'::jsonb);
  RETURN COALESCE(v_before, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_platform_pool()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset bags';
  END IF;
  SELECT platform_pool INTO v_before FROM admin_treasury WHERE id = 1;
  UPDATE admin_treasury SET platform_pool = 0, updated_at = now() WHERE id = 1;
  INSERT INTO admin_treasury_ledger (type, bag, amount, description)
  VALUES ('manual_reset', 'platform', -COALESCE(v_before, 0),
          'Platform pool reset to 0 (was ' || COALESCE(v_before,0) || '€)');
  PERFORM log_admin_action('reset_platform_pool', 'treasury', 'platform',
    'Reset platform pool from ' || COALESCE(v_before,0) || '€ to 0', '{}'::jsonb);
  RETURN COALESCE(v_before, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_driver_wallets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_avail numeric; v_pending numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset driver wallets';
  END IF;
  SELECT COALESCE(SUM(available_balance),0), COALESCE(SUM(pending_balance),0)
    INTO v_avail, v_pending FROM driver_wallets;
  UPDATE driver_wallets SET available_balance = 0, pending_balance = 0, updated_at = now();
  PERFORM log_admin_action('reset_all_driver_wallets', 'driver_wallets', NULL,
    'Reset all driver wallets (available=' || v_avail || '€, pending=' || v_pending || '€)',
    jsonb_build_object('available_before', v_avail, 'pending_before', v_pending));
  RETURN jsonb_build_object('available_before', v_avail, 'pending_before', v_pending);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_store_wallet(p_store_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_before numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store wallets';
  END IF;
  SELECT available_balance INTO v_before FROM store_wallets WHERE store_id = p_store_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Store wallet not found'; END IF;
  UPDATE store_wallets SET available_balance = 0, updated_at = now() WHERE store_id = p_store_id;
  INSERT INTO store_wallet_ledger (store_id, type, amount, description, created_by)
  VALUES (p_store_id, 'manual_reset', -v_before,
          'Store wallet reset to 0 (was ' || v_before || '€)', auth.uid());
  PERFORM log_admin_action('reset_store_wallet', 'store', p_store_id::text,
    'Reset store wallet from ' || v_before || '€ to 0', '{}'::jsonb);
  RETURN v_before;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_store_wallets()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_total numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset store wallets';
  END IF;
  SELECT COALESCE(SUM(available_balance),0) INTO v_total FROM store_wallets;
  UPDATE store_wallets SET available_balance = 0, updated_at = now();
  PERFORM log_admin_action('reset_all_store_wallets', 'store_wallets', NULL,
    'Reset all store wallets (total ' || v_total || '€)',
    jsonb_build_object('total_before', v_total));
  RETURN v_total;
END; $$;

-- 3) Extend create_custom_order to accept driver_payout & store_charge overrides (admin/support only)
CREATE OR REPLACE FUNCTION public.create_custom_order(
  p_store_id uuid,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_distance_km numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_items_summary text DEFAULT NULL,
  p_delivery_fee_override numeric DEFAULT NULL,
  p_driver_payout_override numeric DEFAULT NULL,
  p_store_charge_override numeric DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_fee numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_combined_notes text;
  v_is_priv boolean;
BEGIN
  v_is_priv := is_support_or_admin(auth.uid());
  IF NOT v_is_priv THEN
    RAISE EXCEPTION 'Only admin/support can create custom orders';
  END IF;
  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;
  IF p_driver_payout_override IS NOT NULL AND (p_driver_payout_override < 0 OR p_driver_payout_override > 50) THEN
    RAISE EXCEPTION 'Driver payout override must be between 0 and 50€';
  END IF;
  IF p_store_charge_override IS NOT NULL AND (p_store_charge_override < 0 OR p_store_charge_override > 1000) THEN
    RAISE EXCEPTION 'Store charge override must be between 0 and 1000€';
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  IF p_delivery_fee_override IS NOT NULL THEN
    v_fee := p_delivery_fee_override;
  ELSE
    v_fee := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  v_driver_pay := COALESCE(p_driver_payout_override, v_fee);
  v_store_charge := p_store_charge_override; -- NULL = no extra store charge for in-app custom orders

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END
  );

  INSERT INTO orders (
    store_id, status, source,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout
  ) VALUES (
    p_store_id, 'placed', 'manual',
    p_total_amount, v_fee, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, COALESCE(p_payment_method, 'cash'),
    v_store_charge, v_driver_pay
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (v_order_id, COALESCE(p_items_summary, 'Custom order'), 1, p_total_amount);

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_custom_order', 'order', v_order_id::text,
      'Custom order ' || p_total_amount || '€',
      jsonb_build_object('driver_pay', v_driver_pay, 'store_charge', v_store_charge, 'fee', v_fee)
    );
  END IF;

  RETURN v_order_id;
END; $$;

-- Source: 20260502104113_483017a5-aaee-4fef-a3b6-fee4b99eb2d5.sql
-- HARDENING MIGRATION
-- 1) Chat attachments: remove broad public-read policy, restrict to uploader + support/admin
DROP POLICY IF EXISTS "Chat attachments public read" ON storage.objects;

CREATE POLICY "Uploader or support reads chat attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.is_support_or_admin(auth.uid())
  )
);

-- Make chat-attachments bucket private (signed URLs / RLS-only access)
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- 2) Avatars bucket: keep public reads (used in <img src>), but harden listing
-- Drop the redundant/narrow "own avatar only" SELECT policy that blocks public reads
DROP POLICY IF EXISTS "Users can read their own avatar files" ON storage.objects;

-- Add an explicit public-read policy so direct URL reads work, but listing is allowed
-- (avatars URLs are not enumerable: they include user ID + filename)
CREATE POLICY "Public can read avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- 3) Lock down SECURITY DEFINER functions: revoke EXECUTE from anon
-- Trigger functions and internal helpers should NEVER be callable from PostgREST.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    -- Always revoke from anon (no SECURITY DEFINER fn should be callable unauthenticated)
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END $$;

-- Trigger functions should not be callable by authenticated users at all
DO $$
DECLARE r record;
  trigger_fns text[] := ARRAY[
    'protect_driver_layout','generate_driver_code','protect_store_active_status',
    'create_customer_rewards','award_loyalty_points','protect_driver_active_status',
    'create_driver_wallet','credit_wallet_on_earning','protect_order_financials',
    'auto_accept_small_orders','update_updated_at_column','handle_new_user',
    'protect_profile_role','validate_store_billing_mode','validate_order_source',
    'settle_order_money_bags','validate_ticket_priority','validate_distribution_mode',
    'validate_driver_offer_action','auto_create_earning_on_delivery',
    'validate_store_promotion_status','protect_store_promotion'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.proname = ANY(trigger_fns)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated, public', r.proname, r.args);
  END LOOP;
END $$;

-- Source: 20260502105107_d3bb058c-ccce-4d01-ac58-c56a85af56d3.sql

-- 1. Restrict platform_settings SELECT to admin/support; expose safe fields via view
DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Authenticated read platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Anyone authed view platform settings" ON public.platform_settings;

CREATE POLICY "Admins and support read platform settings"
ON public.platform_settings
FOR SELECT
TO authenticated
USING (public.is_support_or_admin(auth.uid()));

-- Public-safe view (only fields needed by non-admin clients)
CREATE OR REPLACE VIEW public.platform_settings_public
WITH (security_invoker = true) AS
SELECT
  id,
  platform_service_fee,
  max_cash_cap,
  show_stores_on_driver_map,
  assignment_mode,
  maintenance_mode,
  maintenance_message,
  customer_base_fee,
  customer_per_km_fee
FROM public.platform_settings;

-- The view runs as invoker, so we need a permissive SELECT policy on the
-- underlying table only for these columns. Simpler: bypass via SECURITY DEFINER
-- function that returns a single row.
CREATE OR REPLACE FUNCTION public.get_platform_settings_public()
RETURNS TABLE (
  platform_service_fee numeric,
  max_cash_cap numeric,
  show_stores_on_driver_map boolean,
  assignment_mode text,
  maintenance_mode boolean,
  maintenance_message text,
  customer_base_fee numeric,
  customer_per_km_fee numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    platform_service_fee,
    max_cash_cap,
    show_stores_on_driver_map,
    assignment_mode,
    maintenance_mode,
    maintenance_message,
    customer_base_fee,
    customer_per_km_fee
  FROM public.platform_settings
  WHERE id = 1
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_settings_public() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_settings_public() TO authenticated;

-- 2. Restrict commission_tiers SELECT to admins + store owners
DROP POLICY IF EXISTS "Authenticated read commission tiers" ON public.commission_tiers;

CREATE POLICY "Admins and store owners read commission tiers"
ON public.commission_tiers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'store'::app_role)
);

-- 3. Fix delivery-proofs storage policy
DROP POLICY IF EXISTS "Store owners view their order proofs" ON storage.objects;

CREATE POLICY "Store owners view their order proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'delivery-proofs'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    WHERE s.owner_id = auth.uid()
      AND o.id::text = (storage.foldername(name))[1]
  )
);

-- 4. Realtime: require authentication for Broadcast/Presence on realtime.messages
DO $$
BEGIN
  EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
EXCEPTION WHEN others THEN NULL;
END$$;

DROP POLICY IF EXISTS "Authenticated can read realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can write realtime messages" ON realtime.messages;

CREATE POLICY "Authenticated can read realtime messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated can write realtime messages"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (true);


-- Source: 20260502144022_d87e72d7-918f-49b7-bc97-fa3fc537a4ec.sql
DROP FUNCTION IF EXISTS public.create_external_order(uuid, text, numeric, text, double precision, double precision, numeric, text, text, text, text, numeric, numeric, text);

-- Source: 20260502144756_856e41f3-2484-48df-b0ec-865439649202.sql
-- 1. Columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prep_minutes_actual numeric,
  ADD COLUMN IF NOT EXISTS predicted_ready_at timestamptz;

-- 2. Trigger: capture actual prep time at ready
CREATE OR REPLACE FUNCTION public.capture_prep_duration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ready' AND COALESCE(OLD.status::text, '') <> 'ready'
     AND NEW.prep_minutes_actual IS NULL THEN
    NEW.prep_minutes_actual :=
      GREATEST(0, EXTRACT(EPOCH FROM (now() - NEW.created_at)) / 60.0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_prep_duration ON public.orders;
CREATE TRIGGER trg_capture_prep_duration
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.capture_prep_duration();

-- 3. Improved historical average using the new column (median, last 50 orders)
CREATE OR REPLACE FUNCTION public.get_store_avg_prep_minutes(p_store_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY prep_minutes_actual)
     FROM (
       SELECT prep_minutes_actual
       FROM public.orders
       WHERE store_id = p_store_id
         AND prep_minutes_actual IS NOT NULL
         AND prep_minutes_actual BETWEEN 1 AND 120
       ORDER BY created_at DESC
       LIMIT 50
     ) s),
    20
  )::numeric;
$$;

-- 4. Predicted ready time helper (used by client + dispatcher)
CREATE OR REPLACE FUNCTION public.predict_ready_at(p_store_id uuid, p_created_at timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_min numeric;
  load_count int;
  total_min numeric;
BEGIN
  base_min := public.get_store_avg_prep_minutes(p_store_id);
  SELECT COUNT(*) INTO load_count
  FROM public.orders
  WHERE store_id = p_store_id
    AND status IN ('placed','accepted','preparing');
  total_min := base_min + GREATEST(0, load_count - 2) * 1.5;
  total_min := LEAST(120, GREATEST(5, total_min));
  RETURN p_created_at + (total_min || ' minutes')::interval;
END;
$$;

GRANT EXECUTE ON FUNCTION public.predict_ready_at(uuid, timestamptz) TO authenticated;

-- Source: 20260502144819_309ae7fa-4338-416b-a5bc-7a0068ec13b4.sql
CREATE OR REPLACE FUNCTION public.set_predicted_ready_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.predicted_ready_at IS NULL AND NEW.store_id IS NOT NULL THEN
    NEW.predicted_ready_at := public.predict_ready_at(NEW.store_id, COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_predicted_ready_at ON public.orders;
CREATE TRIGGER trg_set_predicted_ready_at
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_predicted_ready_at();

-- Source: 20260502144850_2f010ff5-080e-4a8a-b323-263764fc8d3a.sql
CREATE OR REPLACE FUNCTION public.guard_picked_up_requires_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status::text = 'picked_up'
     AND OLD.status::text NOT IN ('ready', 'arrived', 'picked_up') THEN
    RAISE EXCEPTION 'Order must be marked ready by the store before pickup'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_picked_up_requires_ready ON public.orders;
CREATE TRIGGER trg_guard_picked_up_requires_ready
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_picked_up_requires_ready();

-- Source: 20260502233243_792596e1-2057-4435-aa83-a61c97f142da.sql
-- 1. Add Smart Buffer fields to stores
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS ext_smart_target_pct numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ext_smart_min_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ext_smart_max_pct numeric NOT NULL DEFAULT 20;

-- 2. Allow new billing mode value
CREATE OR REPLACE FUNCTION public.validate_store_billing_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.ext_billing_mode NOT IN ('commission','flat_fee','driver_plus_margin','smart_buffer') THEN
    RAISE EXCEPTION 'Invalid ext_billing_mode: %', NEW.ext_billing_mode;
  END IF;
  IF NEW.ext_smart_min_pct < 5 OR NEW.ext_smart_min_pct > 30 THEN
    RAISE EXCEPTION 'ext_smart_min_pct must be between 5 and 30';
  END IF;
  IF NEW.ext_smart_max_pct < NEW.ext_smart_min_pct OR NEW.ext_smart_max_pct > 40 THEN
    RAISE EXCEPTION 'ext_smart_max_pct must be >= min and <= 40';
  END IF;
  IF NEW.ext_smart_target_pct < NEW.ext_smart_min_pct OR NEW.ext_smart_target_pct > NEW.ext_smart_max_pct THEN
    RAISE EXCEPTION 'ext_smart_target_pct must be between min and max';
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Add External Buffer Bag column to admin treasury
ALTER TABLE public.admin_treasury
  ADD COLUMN IF NOT EXISTS external_buffer_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_external_buffer_in numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_external_buffer_out numeric NOT NULL DEFAULT 0;

-- 4. Helper: dynamic smart-buffer pricing for one external order
CREATE OR REPLACE FUNCTION public.compute_smart_buffer_charge(
  p_total numeric,
  p_driver_cost numeric,
  p_target_pct numeric,
  p_min_pct numeric,
  p_max_pct numeric,
  p_buffer_balance numeric
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_charge_at_target numeric;
  v_profit_at_target numeric;
  v_charge numeric;
  v_buffer_delta numeric := 0;
  v_pct numeric;
BEGIN
  v_charge_at_target := ROUND(p_total * p_target_pct / 100.0, 2);
  v_profit_at_target := v_charge_at_target - p_driver_cost;

  IF v_profit_at_target >= 1 THEN
    -- Comfortable order → charge minimum, deposit surplus to buffer
    v_pct := p_min_pct;
    v_charge := ROUND(p_total * v_pct / 100.0, 2);
    v_buffer_delta := ROUND(v_charge_at_target - v_charge, 2); -- positive = into buffer
  ELSIF v_profit_at_target < 0 THEN
    -- Loss order → push toward max, withdraw shortfall from buffer
    v_pct := p_max_pct;
    v_charge := ROUND(p_total * v_pct / 100.0, 2);
    v_buffer_delta := ROUND(v_charge - v_charge_at_target, 2) * -1; -- negative = out of buffer
  ELSE
    -- Marginal → straight at target
    v_pct := p_target_pct;
    v_charge := v_charge_at_target;
    v_buffer_delta := 0;
  END IF;

  RETURN jsonb_build_object(
    'charge', v_charge,
    'pct', v_pct,
    'buffer_delta', v_buffer_delta,
    'target_charge', v_charge_at_target,
    'driver_cost', p_driver_cost
  );
END;
$$;

-- 5. Update create_external_order to support smart_buffer mode
CREATE OR REPLACE FUNCTION public.create_external_order(
  p_store_id uuid,
  p_source text,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_distance_km numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_driver_payout_override numeric DEFAULT NULL,
  p_store_charge_override numeric DEFAULT NULL,
  p_items_summary text DEFAULT NULL,
  p_payment_method text DEFAULT 'external'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_treasury admin_treasury%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
  v_pm text;
  v_smart jsonb;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  v_is_priv  := is_support_or_admin(auth.uid());
  v_is_owner := (v_store.owner_id = auth.uid());

  IF NOT (v_is_priv OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to create orders for this store';
  END IF;

  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  IF NOT v_is_priv AND (p_driver_payout_override IS NOT NULL OR p_store_charge_override IS NOT NULL) THEN
    RAISE EXCEPTION 'Only admin/support can override pricing';
  END IF;

  v_pm := COALESCE(NULLIF(p_payment_method, ''), 'external');
  IF v_pm NOT IN ('cash','card','external') THEN
    RAISE EXCEPTION 'Invalid payment_method (got %)', v_pm;
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;
  SELECT * INTO v_treasury FROM admin_treasury WHERE id = 1;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSE
    CASE v_store.ext_billing_mode
      WHEN 'commission'         THEN v_store_charge := ROUND((p_total_amount * v_store.ext_commission_pct / 100)::numeric, 2);
      WHEN 'flat_fee'           THEN v_store_charge := v_store.ext_flat_fee;
      WHEN 'driver_plus_margin' THEN v_store_charge := ROUND((v_driver_pay * (1 + v_store.ext_margin_pct / 100))::numeric, 2);
      WHEN 'smart_buffer'       THEN
        v_smart := compute_smart_buffer_charge(
          p_total_amount, v_driver_pay,
          v_store.ext_smart_target_pct, v_store.ext_smart_min_pct, v_store.ext_smart_max_pct,
          COALESCE(v_treasury.external_buffer_balance, 0)
        );
        v_store_charge := (v_smart->>'charge')::numeric;
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END,
    CASE WHEN v_pm = 'cash' THEN '💶 ΜΕΤΡΗΤΑ — εισπράττει ο οδηγός' END,
    CASE WHEN v_smart IS NOT NULL THEN '⚖️ Smart ' || (v_smart->>'pct') || '% (buffer Δ ' || (v_smart->>'buffer_delta') || '€)' END
  );

  INSERT INTO orders (
    store_id, status, source, external_ref,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout, platform_profit
  ) VALUES (
    p_store_id, 'placed', p_source, p_external_ref,
    p_total_amount, v_driver_pay, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, v_pm,
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  -- Apply smart buffer ledger entry immediately (independent of delivery settlement)
  IF v_smart IS NOT NULL AND (v_smart->>'buffer_delta')::numeric <> 0 THEN
    DECLARE
      v_delta numeric := (v_smart->>'buffer_delta')::numeric;
      v_new_balance numeric;
    BEGIN
      -- SAFETY: never let buffer go below 0 by drawing from driver pool
      v_new_balance := COALESCE(v_treasury.external_buffer_balance, 0) + v_delta;
      IF v_new_balance < 0 THEN
        -- Cap withdrawal at available buffer; admin alert needed
        v_delta := -COALESCE(v_treasury.external_buffer_balance, 0);
      END IF;

      IF v_delta <> 0 THEN
        UPDATE admin_treasury
          SET external_buffer_balance = external_buffer_balance + v_delta,
              lifetime_external_buffer_in  = lifetime_external_buffer_in  + GREATEST(v_delta, 0),
              lifetime_external_buffer_out = lifetime_external_buffer_out + GREATEST(-v_delta, 0),
              updated_at = now()
          WHERE id = 1;

        INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
        VALUES (
          v_order_id,
          CASE WHEN v_delta > 0 THEN 'external_buffer_in' ELSE 'external_buffer_out' END,
          'external_buffer',
          v_delta,
          'Smart buffer ' || (v_smart->>'pct') || '% on €' || p_total_amount
        );
      END IF;
    END;
  END IF;

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' (' || v_pm || ') for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'payment_method', v_pm,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit,
        'smart', v_smart
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- Source: 20260502234124_d827cd46-2999-4dcc-a4af-341ea8dfc213.sql

-- 1) Move any remaining External Buffer balance into the Driver Pool (platform_pool)
UPDATE public.admin_treasury
SET
  platform_pool = COALESCE(platform_pool,0) + COALESCE(external_buffer_balance,0),
  lifetime_platform_earned = COALESCE(lifetime_platform_earned,0) + COALESCE(external_buffer_balance,0),
  updated_at = now()
WHERE id = 1;

-- 2) Drop the now-unified buffer columns
ALTER TABLE public.admin_treasury
  DROP COLUMN IF EXISTS external_buffer_balance,
  DROP COLUMN IF EXISTS lifetime_external_buffer_in,
  DROP COLUMN IF EXISTS lifetime_external_buffer_out;

-- 3) Drop the obsolete smart-buffer per-store columns
ALTER TABLE public.stores
  DROP COLUMN IF EXISTS ext_smart_target_pct,
  DROP COLUMN IF EXISTS ext_smart_min_pct,
  DROP COLUMN IF EXISTS ext_smart_max_pct;

-- 4) Migrate any store stuck on smart_buffer back to the default tiered model
UPDATE public.stores
SET ext_billing_mode = 'tiered'
WHERE ext_billing_mode = 'smart_buffer' OR ext_billing_mode IS NULL;

-- 5) Drop helper that's no longer used
DROP FUNCTION IF EXISTS public.compute_smart_buffer_charge(numeric, numeric, numeric, numeric, numeric, numeric);

-- 6) Helper: pick commission % from commission_tiers (same as internal orders)
CREATE OR REPLACE FUNCTION public.commission_pct_for_amount(p_amount numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT commission_pct
      FROM public.commission_tiers
      WHERE is_active = true
        AND p_amount >= min_amount
        AND (max_amount IS NULL OR p_amount < max_amount)
      ORDER BY min_amount DESC
      LIMIT 1
    ),
    15
  );
$$;

-- 7) Rewrite create_external_order: simple, mirrors internal commission tiers
CREATE OR REPLACE FUNCTION public.create_external_order(
  p_store_id uuid,
  p_source text,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_distance_km numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_driver_payout_override numeric DEFAULT NULL,
  p_store_charge_override numeric DEFAULT NULL,
  p_items_summary text DEFAULT NULL,
  p_payment_method text DEFAULT 'external'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_pct numeric;
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
  v_pm text;
  v_mode text;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  v_is_priv  := is_support_or_admin(auth.uid());
  v_is_owner := (v_store.owner_id = auth.uid());

  IF NOT (v_is_priv OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to create orders for this store';
  END IF;

  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  IF NOT v_is_priv AND (p_driver_payout_override IS NOT NULL OR p_store_charge_override IS NOT NULL) THEN
    RAISE EXCEPTION 'Only admin/support can override pricing';
  END IF;

  v_pm := COALESCE(NULLIF(p_payment_method, ''), 'external');
  IF v_pm NOT IN ('cash','card','external') THEN
    RAISE EXCEPTION 'Invalid payment_method (got %)', v_pm;
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  -- Driver payout (same rule as internal orders)
  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  v_mode := COALESCE(v_store.ext_billing_mode, 'tiered');

  -- Store charge — default uses commission_tiers (same as internal)
  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSIF v_mode = 'commission' THEN
    v_store_charge := ROUND((p_total_amount * COALESCE(v_store.ext_commission_pct,15) / 100)::numeric, 2);
  ELSIF v_mode = 'flat_fee' THEN
    v_store_charge := COALESCE(v_store.ext_flat_fee, 0);
  ELSIF v_mode = 'driver_plus_margin' THEN
    v_store_charge := ROUND((v_driver_pay * (1 + COALESCE(v_store.ext_margin_pct,0) / 100))::numeric, 2);
  ELSE
    -- 'tiered' (default): same commission tiers as internal orders
    v_pct := commission_pct_for_amount(p_total_amount);
    v_store_charge := ROUND((p_total_amount * v_pct / 100)::numeric, 2);
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END,
    CASE WHEN v_pm = 'cash' THEN '💶 ΜΕΤΡΗΤΑ — εισπράττει ο οδηγός' END
  );

  INSERT INTO orders (
    store_id, status, source, external_ref,
    total_amount, delivery_fee, distance_km,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, payment_method,
    store_charge, driver_payout, platform_profit
  ) VALUES (
    p_store_id, 'placed', p_source, p_external_ref,
    p_total_amount, v_driver_pay, p_distance_km,
    p_delivery_address, p_delivery_lat, p_delivery_lng,
    v_combined_notes, v_pm,
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' (' || v_pm || ') for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'payment_method', v_pm,
        'mode', v_mode,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;


-- Source: 20260503000314_2a488a89-8853-43b5-a194-1bd4407e939a.sql
CREATE OR REPLACE FUNCTION public.validate_store_billing_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ext_billing_mode NOT IN ('tiered','commission','flat_fee','driver_plus_margin') THEN
    RAISE EXCEPTION 'Invalid ext_billing_mode: %', NEW.ext_billing_mode;
  END IF;
  RETURN NEW;
END;
$$;

-- Source: 20260507001254_ac744fda-2caa-47ce-a7a2-f4f2e1e221d2.sql
-- 1. Bulk-settle all open driver cash debts in one call
CREATE OR REPLACE FUNCTION public.admin_settle_all_driver_cash()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d record;
  v_count integer := 0;
  v_total numeric := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can bulk-settle cash';
  END IF;

  FOR d IN SELECT id, amount_owed FROM public.driver_cash_debts WHERE NOT settled LOOP
    PERFORM public.admin_settle_driver_cash(d.id);
    v_count := v_count + 1;
    v_total := v_total + COALESCE(d.amount_owed, 0);
  END LOOP;

  PERFORM public.log_admin_action('bulk_settle_cash', 'treasury', NULL,
    'Bulk-settled ' || v_count || ' debts (' || v_total || '€)',
    jsonb_build_object('count', v_count, 'total', v_total));

  RETURN jsonb_build_object('settled', v_count, 'total', v_total);
END;
$$;

-- 2. Auto-close previous month (idempotent)
CREATE OR REPLACE FUNCTION public.admin_auto_close_previous_month()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start date := (date_trunc('month', now()) - interval '1 month')::date;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM public.monthly_reports WHERE period_start = v_start LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  -- Only admins can call directly; cron job runs as table owner so SECURITY DEFINER bypass is via separate wrapper
  RETURN public.admin_close_month(v_start);
END;
$$;

-- 3. Low-pool threshold setting + health check
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS low_pool_threshold numeric NOT NULL DEFAULT 50;

CREATE OR REPLACE FUNCTION public.get_treasury_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t admin_treasury%ROWTYPE;
  ps platform_settings%ROWTYPE;
  v_open_debts numeric;
  v_open_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO t FROM admin_treasury WHERE id = 1;
  SELECT * INTO ps FROM platform_settings WHERE id = 1;
  SELECT COALESCE(SUM(amount_owed), 0), COUNT(*) INTO v_open_debts, v_open_count
    FROM driver_cash_debts WHERE NOT settled;

  RETURN jsonb_build_object(
    'pool_balance', t.platform_pool,
    'pool_low', t.platform_pool < COALESCE(ps.low_pool_threshold, 50),
    'pool_negative', t.platform_pool < 0,
    'threshold', COALESCE(ps.low_pool_threshold, 50),
    'open_cash_debts_total', v_open_debts,
    'open_cash_debts_count', v_open_count
  );
END;
$$;

-- 4. Schedule auto month-close via pg_cron (1st of month, 03:00 UTC)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-previous-month') THEN
    PERFORM cron.unschedule('auto-close-previous-month');
  END IF;
  PERFORM cron.schedule(
    'auto-close-previous-month',
    '0 3 1 * *',
    $cron$ SELECT public.admin_auto_close_previous_month(); $cron$
  );
END $$;

-- Source: 20260509000351_fcfa8fee-bfb9-49e3-a65b-7898ed32c3f3.sql

-- 1) RESET MONEY TO ZERO -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_money_to_zero()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_admin_bal numeric;
  v_platform_bal numeric;
  v_store_total numeric;
  v_driver_avail numeric;
  v_driver_pending numeric;
  v_driver_cash numeric;
  v_unsettled_debts numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset money';
  END IF;

  SELECT COALESCE(admin_balance,0), COALESCE(platform_pool,0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(available_balance),0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance),0), COALESCE(SUM(pending_balance),0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance),0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed),0) INTO v_unsettled_debts
    FROM driver_cash_debts WHERE settled = false;

  v_snapshot := jsonb_build_object(
    'reset_at', now(),
    'reset_by', auth.uid(),
    'admin_balance_before', v_admin_bal,
    'platform_pool_before', v_platform_bal,
    'store_wallets_total_before', v_store_total,
    'driver_available_total_before', v_driver_avail,
    'driver_pending_total_before', v_driver_pending,
    'driver_shift_cash_total_before', v_driver_cash,
    'unsettled_cash_debts_before', v_unsettled_debts
  );

  UPDATE admin_treasury
     SET admin_balance = 0, platform_pool = 0, updated_at = now()
   WHERE id = 1;

  UPDATE store_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL OR driver_id IS NULL; -- match-all with WHERE

  UPDATE driver_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE driver_state
     SET shift_cash_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE customer_wallets
     SET balance = 0, updated_at = now()
   WHERE user_id IS NOT NULL;

  UPDATE driver_cash_debts
     SET settled = true, settled_at = now(), settled_by = auth.uid()
   WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system',
          'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$function$;

-- store_wallets has no driver_id; rewrite the WHERE properly
CREATE OR REPLACE FUNCTION public.admin_reset_money_to_zero()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_admin_bal numeric;
  v_platform_bal numeric;
  v_store_total numeric;
  v_driver_avail numeric;
  v_driver_pending numeric;
  v_driver_cash numeric;
  v_unsettled_debts numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset money';
  END IF;

  SELECT COALESCE(admin_balance,0), COALESCE(platform_pool,0)
    INTO v_admin_bal, v_platform_bal
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(available_balance),0) INTO v_store_total FROM store_wallets;
  SELECT COALESCE(SUM(available_balance),0), COALESCE(SUM(pending_balance),0)
    INTO v_driver_avail, v_driver_pending FROM driver_wallets;
  SELECT COALESCE(SUM(shift_cash_balance),0) INTO v_driver_cash FROM driver_state;
  SELECT COALESCE(SUM(amount_owed),0) INTO v_unsettled_debts
    FROM driver_cash_debts WHERE settled = false;

  v_snapshot := jsonb_build_object(
    'reset_at', now(), 'reset_by', auth.uid(),
    'admin_balance_before', v_admin_bal,
    'platform_pool_before', v_platform_bal,
    'store_wallets_total_before', v_store_total,
    'driver_available_total_before', v_driver_avail,
    'driver_pending_total_before', v_driver_pending,
    'driver_shift_cash_total_before', v_driver_cash,
    'unsettled_cash_debts_before', v_unsettled_debts
  );

  UPDATE admin_treasury
     SET admin_balance = 0, platform_pool = 0, updated_at = now()
   WHERE id = 1;

  UPDATE store_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_state
     SET shift_cash_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE customer_wallets
     SET balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_cash_debts
     SET settled = true, settled_at = now(), settled_by = auth.uid()
   WHERE settled = false;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'reset_money_to_zero', 'system',
          'All wallets and treasury reset to 0', v_snapshot);

  RETURN v_snapshot;
END;
$function$;


-- 2) WIPE TRANSACTIONS -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wipe_transactions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_orders int; v_order_items int; v_earnings int;
  v_admin_ledger int; v_store_ledger int; v_customer_ledger int;
  v_monthly int; v_debts int; v_offers int;
  v_fraud int; v_tickets int; v_driver_notifs int;
  v_pending_offers int; v_refunds int; v_reviews int;
  v_rewards_hist int; v_groups int; v_wallet_tx int;
  v_wait_bonus int; v_summary int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can wipe transactions';
  END IF;

  SELECT COUNT(*) INTO v_orders FROM orders;
  SELECT COUNT(*) INTO v_order_items FROM order_items;
  SELECT COUNT(*) INTO v_earnings FROM earnings;
  SELECT COUNT(*) INTO v_admin_ledger FROM admin_treasury_ledger;
  SELECT COUNT(*) INTO v_store_ledger FROM store_wallet_ledger;
  SELECT COUNT(*) INTO v_customer_ledger FROM customer_wallet_ledger;
  SELECT COUNT(*) INTO v_monthly FROM monthly_reports;
  SELECT COUNT(*) INTO v_debts FROM driver_cash_debts;
  SELECT COUNT(*) INTO v_offers FROM driver_offer_events;
  SELECT COUNT(*) INTO v_fraud FROM fraud_signals;
  SELECT COUNT(*) INTO v_tickets FROM support_tickets;
  SELECT COUNT(*) INTO v_driver_notifs FROM driver_notifications;
  SELECT COUNT(*) INTO v_pending_offers FROM pending_offers;
  SELECT COUNT(*) INTO v_refunds FROM refunds;
  SELECT COUNT(*) INTO v_reviews FROM reviews;
  SELECT COUNT(*) INTO v_rewards_hist FROM reward_history;
  SELECT COUNT(*) INTO v_groups FROM group_orders;
  SELECT COUNT(*) INTO v_wallet_tx FROM wallet_transactions;
  SELECT COUNT(*) INTO v_wait_bonus FROM wait_time_bonuses;
  SELECT COUNT(*) INTO v_summary FROM store_daily_summary_log;

  v_snapshot := jsonb_build_object(
    'wiped_at', now(), 'wiped_by', auth.uid(),
    'orders_deleted', v_orders,
    'order_items_deleted', v_order_items,
    'earnings_deleted', v_earnings,
    'admin_ledger_deleted', v_admin_ledger,
    'store_ledger_deleted', v_store_ledger,
    'customer_ledger_deleted', v_customer_ledger,
    'monthly_reports_deleted', v_monthly,
    'cash_debts_deleted', v_debts,
    'offer_events_deleted', v_offers,
    'pending_offers_deleted', v_pending_offers,
    'fraud_signals_deleted', v_fraud,
    'support_tickets_deleted', v_tickets,
    'driver_notifications_deleted', v_driver_notifs,
    'refunds_deleted', v_refunds,
    'reviews_deleted', v_reviews,
    'reward_history_deleted', v_rewards_hist,
    'group_orders_deleted', v_groups,
    'wallet_transactions_deleted', v_wallet_tx,
    'wait_time_bonuses_deleted', v_wait_bonus,
    'store_daily_summary_deleted', v_summary
  );

  -- Delete in dependency order, all with WHERE
  DELETE FROM order_item_modifiers WHERE order_item_id IS NOT NULL;
  DELETE FROM order_items           WHERE order_id IS NOT NULL;
  DELETE FROM earnings              WHERE id IS NOT NULL;
  DELETE FROM driver_cash_debts     WHERE id IS NOT NULL;
  DELETE FROM driver_offer_events   WHERE id IS NOT NULL;
  DELETE FROM pending_offers        WHERE id IS NOT NULL;
  DELETE FROM wait_time_bonuses     WHERE id IS NOT NULL;
  DELETE FROM wallet_transactions   WHERE id IS NOT NULL;
  DELETE FROM refunds               WHERE id IS NOT NULL;
  DELETE FROM reviews               WHERE id IS NOT NULL;
  DELETE FROM reward_history        WHERE id IS NOT NULL;
  DELETE FROM admin_treasury_ledger WHERE id IS NOT NULL;
  DELETE FROM store_wallet_ledger   WHERE id IS NOT NULL;
  DELETE FROM customer_wallet_ledger WHERE id IS NOT NULL;
  DELETE FROM monthly_reports       WHERE id IS NOT NULL;
  DELETE FROM fraud_signals         WHERE id IS NOT NULL;
  DELETE FROM ticket_messages       WHERE id IS NOT NULL;
  DELETE FROM support_tickets       WHERE id IS NOT NULL;
  DELETE FROM driver_notifications  WHERE id IS NOT NULL;
  DELETE FROM group_order_participants WHERE id IS NOT NULL;
  DELETE FROM group_orders          WHERE id IS NOT NULL;
  DELETE FROM store_daily_summary_log WHERE id IS NOT NULL;
  -- orders has self-FK; null it first
  UPDATE orders SET stacked_with_order_id = NULL WHERE stacked_with_order_id IS NOT NULL;
  DELETE FROM orders                WHERE id IS NOT NULL;

  -- Reset every balance to absolute zero (incl. lifetime)
  UPDATE admin_treasury
     SET admin_balance = 0, platform_pool = 0,
         lifetime_admin_earned = 0, lifetime_platform_earned = 0,
         lifetime_driver_topup = 0, updated_at = now()
   WHERE id = 1;

  UPDATE store_wallets
     SET available_balance = 0, pending_balance = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_wallets
     SET available_balance = 0, pending_balance = 0, total_withdrawn = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE driver_state
     SET shift_cash_balance = 0, updated_at = now()
   WHERE driver_id IS NOT NULL;

  UPDATE customer_wallets
     SET balance = 0, lifetime_credit = 0, updated_at = now()
   WHERE id IS NOT NULL;

  UPDATE customer_rewards
     SET points = 0, lifetime_points = 0, tier = 'bronze', updated_at = now()
   WHERE id IS NOT NULL;

  INSERT INTO admin_audit_log (actor_id, action, target_type, description, metadata)
  VALUES (auth.uid(), 'wipe_transactions', 'system',
          'Wiped all transactional data and reset balances to zero', v_snapshot);

  RETURN v_snapshot;
END;
$function$;


-- 3) PRICING MODEL VIEW -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_pricing_model
WITH (security_invoker=on) AS
SELECT
  ps.id,
  GREATEST(COALESCE(ps.admin_share_pct, 5), 5)               AS admin_pct,
  GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10) AS driver_pool_pct,
  GREATEST(COALESCE(ps.default_commission_pct, 15), 15)      AS default_commission_pct,
  100 - GREATEST(COALESCE(ps.default_commission_pct, 15), 15) AS default_store_keeps_pct
FROM public.platform_settings ps
WHERE ps.id = 1;

GRANT SELECT ON public.v_pricing_model TO authenticated;


-- Source: 20260510000352_f349e983-53a6-4f12-9648-43515c3a9c12.sql
-- 1. New tunable settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pool_healthy_threshold numeric NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS pool_critical_threshold numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS pool_low_multiplier numeric NOT NULL DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS pool_critical_multiplier numeric NOT NULL DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS max_pay numeric NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS subsidize_min_pay boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pool_alert_enabled boolean NOT NULL DEFAULT true;

-- 2. New order column for the per-order bonus paid from pool
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS driver_pool_bonus numeric NOT NULL DEFAULT 0;

-- 3. Helper: compute the pool bonus for an order (read-only, idempotent preview)
CREATE OR REPLACE FUNCTION public.compute_driver_pool_bonus(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  o RECORD;
  pool numeric;
  raw_amt numeric;
  clamped numeric;
  mult numeric;
  health text;
  final_amt numeric;
  subsidy numeric := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT base_pay, per_km_rate, min_pay, max_pay,
         pool_healthy_threshold, low_pool_threshold, pool_critical_threshold,
         pool_low_multiplier, pool_critical_multiplier,
         subsidize_min_pay
    INTO s FROM public.platform_settings WHERE id = 1;

  SELECT COALESCE(platform_pool, 0) INTO pool FROM public.admin_treasury WHERE id = 1;

  -- Health multiplier
  IF pool >= s.pool_healthy_threshold THEN
    mult := 1.0; health := 'healthy';
  ELSIF pool >= s.low_pool_threshold THEN
    mult := 1.0; health := 'normal';
  ELSIF pool >= s.pool_critical_threshold THEN
    mult := s.pool_low_multiplier; health := 'low';
  ELSE
    mult := s.pool_critical_multiplier; health := 'critical';
  END IF;

  -- base + per_km * distance, clamped to [min_pay, max_pay], then * health multiplier,
  -- but never below min_pay (admin's promise).
  raw_amt  := COALESCE(s.base_pay,0) + COALESCE(s.per_km_rate,0) * COALESCE(o.distance_km,0);
  clamped  := LEAST(GREATEST(raw_amt, s.min_pay), s.max_pay);
  final_amt := GREATEST(clamped * mult, s.min_pay);

  -- Pool insolvency guard
  IF final_amt > pool THEN
    IF s.subsidize_min_pay AND final_amt >= s.min_pay THEN
      subsidy := LEAST(s.min_pay, final_amt) - LEAST(pool, final_amt);
      subsidy := GREATEST(subsidy, 0);
      final_amt := LEAST(pool, final_amt) + subsidy;
    ELSE
      final_amt := GREATEST(pool, 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'pool_balance',  pool,
    'health',        health,
    'multiplier',    mult,
    'raw',           round(raw_amt::numeric, 2),
    'clamped',       round(clamped::numeric, 2),
    'final',         round(final_amt::numeric, 2),
    'admin_subsidy', round(subsidy::numeric, 2),
    'distance_km',   COALESCE(o.distance_km, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_driver_pool_bonus(uuid) TO authenticated;

-- 4. Rewrite settle_order_commission so on delivery the driver also receives a pool bonus
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  store_extra numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  s RECORD;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  admin_amt    := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt     := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  store_extra  := COALESCE((split->>'store_extra_commission')::numeric, 0);
  pays_delivery := COALESCE((split->>'store_pays_delivery')::boolean, false);

  -- 1) Admin bag in
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 2) Pool top-up in
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 3) Extra store commission -> pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 4) Pool bonus OUT to driver (only for assigned, non-cash orders)
  IF NEW.driver_id IS NOT NULL AND COALESCE(NEW.payment_method, 'card') <> 'cash' THEN
    bonus_info := public.compute_driver_pool_bonus(NEW.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    subsidy_amt := COALESCE((bonus_info->>'admin_subsidy')::numeric, 0);

    IF bonus_amt > 0 THEN
      -- Withdraw from pool (capped at available balance)
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_balance := LEAST(pool_balance, bonus_amt - subsidy_amt);
      IF pool_balance > 0 THEN
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_balance,
              updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_balance, 'platform', 'driver_bonus', NEW.id, 'Pool bonus paid to driver');
      END IF;

      -- Subsidy from admin bag if enabled and needed
      IF subsidy_amt > 0 THEN
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - subsidy_amt,
              updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-subsidy_amt, 'admin', 'pool_subsidy', NEW.id, 'Admin subsidy to honor min driver pay');
      END IF;

      -- Credit driver wallet
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();
    END IF;
  END IF;

  -- 5) Delivery fee to driver (existing behavior)
  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND COALESCE(NEW.payment_method, 'card') <> 'cash' THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  -- 6) Pool health alert (de-duped per day in admin_audit_log)
  SELECT pool_alert_enabled, low_pool_threshold INTO s FROM public.platform_settings WHERE id = 1;
  IF s.pool_alert_enabled THEN
    SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    IF pool_balance < s.low_pool_threshold THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'pool_low_alert'
          AND created_at > now() - interval '24 hours'
      ) THEN
        INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, description, metadata)
        VALUES (NEW.driver_id, 'system', 'pool_low_alert', 'platform_pool',
                'Driver pool dropped below low threshold',
                jsonb_build_object('balance', pool_balance, 'threshold', s.low_pool_threshold));
      END IF;
    END IF;
  END IF;

  -- Persist
  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt + pool_amt + store_extra;
  NEW.driver_payout := delivery_amt + bonus_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.store_charge := admin_amt + pool_amt + store_extra + (CASE WHEN pays_delivery THEN delivery_amt ELSE 0 END);

  RETURN NEW;
END;
$function$;

-- Source: 20260511000717_95f2ddc5-99b4-44d1-870e-c124bf1efa75.sql

-- 1. Seed driver pool to €1000 baseline (only top up if below)
UPDATE public.admin_treasury
SET platform_pool = GREATEST(platform_pool, 1000),
    lifetime_driver_topup = lifetime_driver_topup + GREATEST(1000 - platform_pool, 0),
    updated_at = now()
WHERE id = 1;

INSERT INTO public.admin_treasury_ledger (amount, bag, type, description)
SELECT 1000, 'platform', 'seed', 'Initial driver pool seed €1000'
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_treasury_ledger WHERE type = 'seed' AND bag = 'platform'
);

-- 2. Rewrite settle_order_commission: pay pool bonus on cash too
CREATE OR REPLACE FUNCTION public.settle_order_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  split jsonb;
  admin_amt numeric;
  pool_amt numeric;
  delivery_amt numeric;
  store_extra numeric;
  pays_delivery boolean;
  bonus_info jsonb;
  bonus_amt numeric := 0;
  subsidy_amt numeric := 0;
  pool_balance numeric;
  pool_take numeric;
  is_cash boolean;
  s RECORD;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF NEW.commission_settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;

  split := public.compute_order_split(NEW.id);
  IF split IS NULL THEN RETURN NEW; END IF;

  is_cash      := COALESCE(NEW.payment_method, 'card') = 'cash';
  admin_amt    := COALESCE((split->>'admin_amount')::numeric, 0);
  pool_amt     := COALESCE((split->>'driver_pool_amount')::numeric, 0);
  delivery_amt := COALESCE((split->>'driver_delivery_fee')::numeric, 0);
  store_extra  := COALESCE((split->>'store_extra_commission')::numeric, 0);
  pays_delivery := COALESCE((split->>'store_pays_delivery')::boolean, false);

  -- 1) Admin bag in (5%)
  IF admin_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (admin_amt, 'admin', 'commission', NEW.id, '5% admin share');
    UPDATE public.admin_treasury
      SET admin_balance = admin_balance + admin_amt,
          lifetime_admin_earned = lifetime_admin_earned + admin_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 2) Pool top-up in (10%)
  IF pool_amt > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (pool_amt, 'platform', 'driver_pool', NEW.id, '10% driver pool top-up');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + pool_amt,
          lifetime_platform_earned = lifetime_platform_earned + pool_amt,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 3) Extra store commission (>15%) -> pool
  IF store_extra > 0 THEN
    INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
    VALUES (store_extra, 'platform', 'commission_extra', NEW.id, 'Store commission above 15%');
    UPDATE public.admin_treasury
      SET platform_pool = platform_pool + store_extra,
          lifetime_platform_earned = lifetime_platform_earned + store_extra,
          updated_at = now()
      WHERE id = 1;
  END IF;

  -- 4) Driver pool BONUS (always paid to assigned driver, including cash)
  IF NEW.driver_id IS NOT NULL THEN
    bonus_info := public.compute_driver_pool_bonus(NEW.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    subsidy_amt := COALESCE((bonus_info->>'admin_subsidy')::numeric, 0);

    IF bonus_amt > 0 THEN
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_take := LEAST(pool_balance, GREATEST(bonus_amt - subsidy_amt, 0));
      IF pool_take > 0 THEN
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_take, updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_bonus', NEW.id, 'Pool bonus paid to driver');
      END IF;

      IF subsidy_amt > 0 THEN
        UPDATE public.admin_treasury
          SET admin_balance = admin_balance - subsidy_amt, updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-subsidy_amt, 'admin', 'pool_subsidy', NEW.id, 'Admin subsidy to honor min driver pay');
      END IF;

      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (NEW.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();
    END IF;
  END IF;

  -- 5) Delivery fee to driver wallet — only for non-cash (cash drivers already collected it)
  IF NEW.driver_id IS NOT NULL AND delivery_amt > 0 AND NOT is_cash THEN
    INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
    VALUES (NEW.driver_id, delivery_amt, 0, 0)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = public.driver_wallets.available_balance + delivery_amt,
          updated_at = now();
  END IF;

  -- 6) Pool low alert
  SELECT pool_alert_enabled, low_pool_threshold INTO s FROM public.platform_settings WHERE id = 1;
  IF s.pool_alert_enabled THEN
    SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
    IF pool_balance < s.low_pool_threshold THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'pool_low_alert' AND created_at > now() - interval '24 hours'
      ) THEN
        INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, description, metadata)
        VALUES (NEW.driver_id, 'system', 'pool_low_alert', 'platform_pool',
                'Driver pool dropped below low threshold',
                jsonb_build_object('balance', pool_balance, 'threshold', s.low_pool_threshold));
      END IF;
    END IF;
  END IF;

  NEW.commission_settled_at := now();
  NEW.platform_profit := admin_amt + pool_amt + store_extra;
  NEW.driver_payout := (CASE WHEN is_cash THEN 0 ELSE delivery_amt END) + bonus_amt;
  NEW.driver_pool_bonus := bonus_amt;
  NEW.store_charge := admin_amt + pool_amt + store_extra + (CASE WHEN pays_delivery THEN delivery_amt ELSE 0 END);

  RETURN NEW;
END;
$function$;

-- 3. Backfill: re-settle delivered orders that have €0 driver_payout AND a driver assigned
DO $$
DECLARE
  r RECORD;
  bonus_info jsonb;
  bonus_amt numeric;
  pool_balance numeric;
  pool_take numeric;
BEGIN
  FOR r IN
    SELECT id, driver_id, payment_method, delivery_fee
    FROM public.orders
    WHERE status = 'delivered'
      AND driver_id IS NOT NULL
      AND driver_pool_bonus = 0
      AND commission_settled_at IS NOT NULL
  LOOP
    bonus_info := public.compute_driver_pool_bonus(r.id);
    bonus_amt := COALESCE((bonus_info->>'final')::numeric, 0);
    IF bonus_amt > 0 THEN
      SELECT platform_pool INTO pool_balance FROM public.admin_treasury WHERE id = 1;
      pool_take := LEAST(pool_balance, bonus_amt);
      IF pool_take > 0 THEN
        UPDATE public.admin_treasury
          SET platform_pool = platform_pool - pool_take, updated_at = now()
          WHERE id = 1;
        INSERT INTO public.admin_treasury_ledger (amount, bag, type, order_id, description)
        VALUES (-pool_take, 'platform', 'driver_bonus', r.id, 'Backfill bonus for previously unpaid order');
      END IF;
      INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance, total_withdrawn)
      VALUES (r.driver_id, bonus_amt, 0, 0)
      ON CONFLICT (driver_id) DO UPDATE
        SET available_balance = public.driver_wallets.available_balance + bonus_amt,
            updated_at = now();
      UPDATE public.orders
        SET driver_pool_bonus = bonus_amt,
            driver_payout = driver_payout + bonus_amt
        WHERE id = r.id;
    END IF;
  END LOOP;
END $$;


-- Source: 20260511000957_50a3ff33-04ee-4068-9956-8642605916a3.sql

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


