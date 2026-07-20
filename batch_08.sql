-- Source: 20260421221132_5f3e9c46-20ff-4499-889f-a948b2ea6f5c.sql

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON public.announcements(expires_at);

CREATE POLICY "Support can view their announcements"
ON public.announcements
FOR SELECT
USING (
  target_audience = ANY (ARRAY['support'::text, 'all'::text])
  AND has_role(auth.uid(), 'support'::app_role)
);


-- Source: 20260421222238_7224168d-c332-4fc4-a230-2ba15dc40929.sql
-- ============================================
-- 1. FEATURE FLAGS
-- ============================================
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage feature flags"
  ON public.feature_flags FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users read feature flags"
  ON public.feature_flags FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.feature_flags (key, label, description, category) VALUES
  ('new_orders_enabled', 'Νέες παραγγελίες', 'Επιτρέπει στους πελάτες να κάνουν νέες παραγγελίες', 'orders'),
  ('new_signups_enabled', 'Νέες εγγραφές', 'Επιτρέπει νέες εγγραφές χρηστών', 'auth'),
  ('driver_signups_enabled', 'Εγγραφές οδηγών', 'Επιτρέπει νέες εγγραφές οδηγών', 'auth'),
  ('store_signups_enabled', 'Εγγραφές καταστημάτων', 'Επιτρέπει νέες εγγραφές καταστημάτων', 'auth'),
  ('driver_payouts_enabled', 'Πληρωμές οδηγών', 'Επιτρέπει αιτήσεις cash-out', 'finance'),
  ('promo_codes_enabled', 'Κωδικοί έκπτωσης', 'Επιτρέπει χρήση promo codes στο checkout', 'orders'),
  ('reviews_enabled', 'Κριτικές', 'Επιτρέπει στους πελάτες να αφήνουν κριτικές', 'general'),
  ('chat_support_enabled', 'Chat υποστήριξης', 'Ενεργοποιεί ζωντανό chat με support', 'support'),
  ('ai_support_enabled', 'AI Support', 'Ενεργοποιεί τον AI βοηθό υποστήριξης', 'support')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 2. MAINTENANCE MODE on platform_settings
-- ============================================
ALTER TABLE public.platform_settings 
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message TEXT;

-- ============================================
-- 3. ADMIN SUB-ROLES (permissions)
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'full',
  can_manage_finances BOOLEAN NOT NULL DEFAULT false,
  can_manage_users BOOLEAN NOT NULL DEFAULT false,
  can_manage_orders BOOLEAN NOT NULL DEFAULT false,
  can_manage_settings BOOLEAN NOT NULL DEFAULT false,
  can_view_audit BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage admin permissions"
  ON public.admin_permissions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_admin_permissions_updated_at
  BEFORE UPDATE ON public.admin_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 4. ADMIN AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log (actor_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit log"
  ON public.admin_audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert audit log"
  ON public.admin_audit_log FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

-- Helper to log admin actions
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action TEXT,
  p_target_type TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can log audit actions';
  END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), v_name, p_action, p_target_type, p_target_id, p_description, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

-- ============================================
-- 5. SURGE ZONES (operational override)
-- ============================================
CREATE TABLE IF NOT EXISTS public.surge_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km NUMERIC NOT NULL DEFAULT 2.0,
  multiplier NUMERIC NOT NULL DEFAULT 1.5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.surge_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage surge zones"
  ON public.surge_zones FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read active surge zones"
  ON public.surge_zones FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active = true);

CREATE TRIGGER update_surge_zones_updated_at
  BEFORE UPDATE ON public.surge_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 6. BANNED DEVICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.banned_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_fingerprint TEXT NOT NULL UNIQUE,
  user_id UUID,
  reason TEXT,
  banned_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.banned_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage banned devices"
  ON public.banned_devices FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- Source: 20260422003747_288ba531-8c43-4298-911c-0b4726b8efd8.sql

-- =========================
-- 1. WIPE STORES + RELATED DATA
-- =========================
-- Clear references first
UPDATE public.wallet_transactions SET order_id = NULL WHERE order_id IS NOT NULL;
UPDATE public.wait_time_bonuses SET order_id = NULL WHERE order_id IS NOT NULL;

DELETE FROM public.reviews;
DELETE FROM public.wait_time_bonuses;
DELETE FROM public.order_items;
DELETE FROM public.earnings WHERE order_id IS NOT NULL;
DELETE FROM public.orders;
DELETE FROM public.promo_codes;
DELETE FROM public.menu_items;
DELETE FROM public.store_pricing_overrides;
DELETE FROM public.stores;

-- =========================
-- 2. SUPPORT TICKETS: support store owners too
-- =========================
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS requester_id uuid,
  ADD COLUMN IF NOT EXISTS requester_role text NOT NULL DEFAULT 'driver';

UPDATE public.support_tickets
SET requester_id = driver_id,
    requester_role = 'driver'
WHERE requester_id IS NULL;

ALTER TABLE public.support_tickets
  ALTER COLUMN driver_id DROP NOT NULL;

DROP POLICY IF EXISTS "Store owners can create tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Store owners can view own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Store owners can update own tickets" ON public.support_tickets;

CREATE POLICY "Store owners can create tickets"
  ON public.support_tickets FOR INSERT
  WITH CHECK (
    requester_id = auth.uid()
    AND has_role(auth.uid(), 'store'::app_role)
  );

CREATE POLICY "Store owners can view own tickets"
  ON public.support_tickets FOR SELECT
  USING (
    requester_id = auth.uid()
    AND has_role(auth.uid(), 'store'::app_role)
  );

CREATE POLICY "Store owners can update own tickets"
  ON public.support_tickets FOR UPDATE
  USING (
    requester_id = auth.uid()
    AND has_role(auth.uid(), 'store'::app_role)
  );

DROP POLICY IF EXISTS "Store owners view own ticket messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "Store owners post on own tickets" ON public.ticket_messages;

CREATE POLICY "Store owners view own ticket messages"
  ON public.ticket_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND t.requester_id = auth.uid()
        AND has_role(auth.uid(), 'store'::app_role)
    )
  );

CREATE POLICY "Store owners post on own tickets"
  ON public.ticket_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND t.requester_id = auth.uid()
        AND has_role(auth.uid(), 'store'::app_role)
    )
  );

-- =========================
-- 3. STORE INVENTORY
-- =========================
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS stock_count integer,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT false;

-- =========================
-- 4. STORE HOURS + HOLIDAYS
-- =========================
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS opening_hours jsonb DEFAULT '{
    "mon":{"open":"09:00","close":"22:00","enabled":true},
    "tue":{"open":"09:00","close":"22:00","enabled":true},
    "wed":{"open":"09:00","close":"22:00","enabled":true},
    "thu":{"open":"09:00","close":"22:00","enabled":true},
    "fri":{"open":"09:00","close":"23:00","enabled":true},
    "sat":{"open":"10:00","close":"23:00","enabled":true},
    "sun":{"open":"10:00","close":"22:00","enabled":true}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS holiday_dates date[] DEFAULT '{}'::date[];

-- =========================
-- 5. CUSTOMER FAVORITES
-- =========================
CREATE TABLE IF NOT EXISTS public.customer_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  store_id uuid,
  menu_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorite_target_check CHECK (
    (store_id IS NOT NULL AND menu_item_id IS NULL)
    OR (store_id IS NULL AND menu_item_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_favorites_store_unique
  ON public.customer_favorites (user_id, store_id)
  WHERE store_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_favorites_item_unique
  ON public.customer_favorites (user_id, menu_item_id)
  WHERE menu_item_id IS NOT NULL;

ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own favorites" ON public.customer_favorites;
CREATE POLICY "Users manage own favorites"
  ON public.customer_favorites FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =========================
-- 6. CUSTOMER REWARDS / LOYALTY
-- =========================
CREATE TABLE IF NOT EXISTS public.customer_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  points integer NOT NULL DEFAULT 0,
  tier text NOT NULL DEFAULT 'bronze',
  lifetime_points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own rewards" ON public.customer_rewards;
DROP POLICY IF EXISTS "Admins manage rewards" ON public.customer_rewards;
CREATE POLICY "Users view own rewards"
  ON public.customer_rewards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage rewards"
  ON public.customer_rewards FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.reward_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid,
  points_change integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reward_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own reward history" ON public.reward_history;
DROP POLICY IF EXISTS "Admins manage reward history" ON public.reward_history;
CREATE POLICY "Users view own reward history"
  ON public.reward_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage reward history"
  ON public.reward_history FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.create_customer_rewards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customer_rewards (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_rewards_on_profile ON public.profiles;
CREATE TRIGGER create_rewards_on_profile
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.create_customer_rewards();

INSERT INTO public.customer_rewards (user_id)
SELECT user_id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.award_loyalty_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points integer;
  v_new_total integer;
BEGIN
  IF NEW.status <> 'delivered' OR (OLD.status IS NOT DISTINCT FROM 'delivered') THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_points := FLOOR(COALESCE(NEW.total_amount, 0))::integer;
  IF v_points <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.customer_rewards (user_id, points, lifetime_points)
  VALUES (NEW.customer_id, v_points, v_points)
  ON CONFLICT (user_id) DO UPDATE
    SET points = customer_rewards.points + v_points,
        lifetime_points = customer_rewards.lifetime_points + v_points,
        updated_at = now()
  RETURNING lifetime_points INTO v_new_total;

  UPDATE public.customer_rewards
  SET tier = CASE
    WHEN v_new_total >= 1000 THEN 'platinum'
    WHEN v_new_total >= 500 THEN 'gold'
    WHEN v_new_total >= 200 THEN 'silver'
    ELSE 'bronze'
  END
  WHERE user_id = NEW.customer_id;

  INSERT INTO public.reward_history (user_id, order_id, points_change, reason)
  VALUES (NEW.customer_id, NEW.id, v_points, 'order_delivered');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS award_points_on_delivery ON public.orders;
CREATE TRIGGER award_points_on_delivery
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.award_loyalty_points();


-- Source: 20260422005404_84accc5a-13e6-40db-b9a1-ecd13dad43aa.sql

-- =========================
-- ORDERS extensions
-- =========================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS group_order_id uuid,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS cash_received numeric,
  ADD COLUMN IF NOT EXISTS change_due numeric,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_reason text;

-- =========================
-- GROUP ORDERS
-- =========================
CREATE TABLE IF NOT EXISTS public.group_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  store_id uuid NOT NULL,
  share_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open', -- open | locked | placed | cancelled
  delivery_address text,
  delivery_latitude double precision,
  delivery_longitude double precision,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closes_at timestamptz
);
ALTER TABLE public.group_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own group orders" ON public.group_orders;
CREATE POLICY "Hosts manage own group orders" ON public.group_orders
  FOR ALL USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Anyone authed can view by share code" ON public.group_orders;
CREATE POLICY "Anyone authed can view by share code" ON public.group_orders
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins manage group orders" ON public.group_orders;
CREATE POLICY "Admins manage group orders" ON public.group_orders
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.group_order_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id uuid NOT NULL REFERENCES public.group_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{menu_item_id,name,price,quantity}]
  subtotal numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_order_id, user_id)
);
ALTER TABLE public.group_order_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authed users can view participants" ON public.group_order_participants;
CREATE POLICY "Authed users can view participants" ON public.group_order_participants
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users manage own participation" ON public.group_order_participants;
CREATE POLICY "Users manage own participation" ON public.group_order_participants
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Hosts can remove participants" ON public.group_order_participants;
CREATE POLICY "Hosts can remove participants" ON public.group_order_participants
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.group_orders g
    WHERE g.id = group_order_participants.group_order_id AND g.host_id = auth.uid()
  ));

-- =========================
-- DRIVER STATE (goals + break + COD)
-- =========================
CREATE TABLE IF NOT EXISTS public.driver_state (
  driver_id uuid PRIMARY KEY,
  on_break boolean NOT NULL DEFAULT false,
  break_until timestamptz,
  daily_goal numeric NOT NULL DEFAULT 50,
  weekly_goal numeric NOT NULL DEFAULT 300,
  shift_cash_balance numeric NOT NULL DEFAULT 0,
  shift_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers manage own state" ON public.driver_state;
CREATE POLICY "Drivers manage own state" ON public.driver_state
  FOR ALL USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);

DROP POLICY IF EXISTS "Admins view driver state" ON public.driver_state;
CREATE POLICY "Admins view driver state" ON public.driver_state
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

-- =========================
-- STORE AUTO-ACCEPT RULES
-- =========================
CREATE TABLE IF NOT EXISTS public.store_auto_accept_rules (
  store_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  max_amount numeric NOT NULL DEFAULT 25,
  default_prep_minutes integer NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_auto_accept_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own auto-accept" ON public.store_auto_accept_rules;
CREATE POLICY "Owners manage own auto-accept" ON public.store_auto_accept_rules
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = store_auto_accept_rules.store_id AND s.owner_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = store_auto_accept_rules.store_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins manage auto-accept" ON public.store_auto_accept_rules;
CREATE POLICY "Admins manage auto-accept" ON public.store_auto_accept_rules
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

-- Auto-accept trigger
CREATE OR REPLACE FUNCTION public.auto_accept_small_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r store_auto_accept_rules%ROWTYPE;
BEGIN
  IF NEW.status <> 'placed' THEN RETURN NEW; END IF;
  SELECT * INTO r FROM store_auto_accept_rules WHERE store_id = NEW.store_id;
  IF FOUND AND r.enabled AND COALESCE(NEW.total_amount, 0) <= r.max_amount THEN
    NEW.status := 'accepted';
    NEW.estimated_prep_time := COALESCE(NEW.estimated_prep_time, r.default_prep_minutes);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_accept_small_orders ON public.orders;
CREATE TRIGGER trg_auto_accept_small_orders
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.auto_accept_small_orders();

-- =========================
-- ITEM MODIFIERS
-- =========================
CREATE TABLE IF NOT EXISTS public.menu_item_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL,
  group_name text NOT NULL,            -- "Size", "Extras", "Remove"
  option_name text NOT NULL,           -- "Large", "Cheese", "Onions"
  price_delta numeric NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  is_multi boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.menu_item_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Modifiers viewable by everyone" ON public.menu_item_modifiers;
CREATE POLICY "Modifiers viewable by everyone" ON public.menu_item_modifiers
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owners manage own modifiers" ON public.menu_item_modifiers;
CREATE POLICY "Owners manage own modifiers" ON public.menu_item_modifiers
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.menu_items mi
    JOIN public.stores s ON s.id = mi.store_id
    WHERE mi.id = menu_item_modifiers.menu_item_id AND s.owner_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.menu_items mi
    JOIN public.stores s ON s.id = mi.store_id
    WHERE mi.id = menu_item_modifiers.menu_item_id AND s.owner_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS public.order_item_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL,
  group_name text NOT NULL,
  option_name text NOT NULL,
  price_delta numeric NOT NULL DEFAULT 0
);
ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authed users view order item modifiers" ON public.order_item_modifiers;
CREATE POLICY "Authed users view order item modifiers" ON public.order_item_modifiers
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authed users insert order item modifiers" ON public.order_item_modifiers;
CREATE POLICY "Authed users insert order item modifiers" ON public.order_item_modifiers
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- =========================
-- REFUNDS
-- =========================
CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  customer_id uuid,
  amount numeric NOT NULL,
  reason text,
  refund_type text NOT NULL DEFAULT 'wallet_credit', -- wallet_credit | original_payment | manual
  notes text,
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins/Support manage refunds" ON public.refunds;
CREATE POLICY "Admins/Support manage refunds" ON public.refunds
  FOR ALL USING (is_support_or_admin(auth.uid()))
  WITH CHECK (is_support_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Customers view own refunds" ON public.refunds;
CREATE POLICY "Customers view own refunds" ON public.refunds
  FOR SELECT USING (auth.uid() = customer_id);

-- =========================
-- CANNED REPLIES
-- =========================
CREATE TABLE IF NOT EXISTS public.canned_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  body text NOT NULL,
  category text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.canned_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Support and admins read canned replies" ON public.canned_replies;
CREATE POLICY "Support and admins read canned replies" ON public.canned_replies
  FOR SELECT USING (is_support_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage canned replies" ON public.canned_replies;
CREATE POLICY "Admins manage canned replies" ON public.canned_replies
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

-- Seed a few defaults if empty
INSERT INTO public.canned_replies (label, body, category, sort_order)
SELECT * FROM (VALUES
  ('Greeting', 'Hello! Thanks for reaching out — how can I help you today?', 'general', 1),
  ('Investigating', 'I''m looking into this right now and will get back to you in a moment.', 'general', 2),
  ('Late delivery', 'Sorry for the wait. The driver is on the way and should arrive shortly.', 'delivery', 3),
  ('Wrong item', 'I''m so sorry about the mix-up. Let me arrange a fix or refund right away.', 'order', 4),
  ('Closing', 'Glad we could help. Have a great day!', 'general', 5)
) AS t(label, body, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.canned_replies);

-- =========================
-- FRAUD SIGNALS
-- =========================
CREATE TABLE IF NOT EXISTS public.fraud_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  signal_type text NOT NULL,    -- many_refunds | new_device | chargeback | rapid_orders | promo_abuse
  severity text NOT NULL DEFAULT 'medium', -- low | medium | high
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fraud_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage fraud signals" ON public.fraud_signals;
CREATE POLICY "Admins manage fraud signals" ON public.fraud_signals
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Support read fraud signals" ON public.fraud_signals;
CREATE POLICY "Support read fraud signals" ON public.fraud_signals
  FOR SELECT USING (is_support_or_admin(auth.uid()));

-- =========================
-- STORE DAILY SUMMARY LOG (for cron dedup)
-- =========================
CREATE TABLE IF NOT EXISTS public.store_daily_summary_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  summary_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, summary_date)
);
ALTER TABLE public.store_daily_summary_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners view own summary log" ON public.store_daily_summary_log;
CREATE POLICY "Owners view own summary log" ON public.store_daily_summary_log
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = store_daily_summary_log.store_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins manage summary log" ON public.store_daily_summary_log;
CREATE POLICY "Admins manage summary log" ON public.store_daily_summary_log
  FOR ALL USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

-- =========================
-- RPC: refund order with audit + wallet credit
-- =========================
CREATE OR REPLACE FUNCTION public.refund_order(
  p_order_id uuid,
  p_amount numeric,
  p_reason text,
  p_refund_type text DEFAULT 'wallet_credit',
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_refund_id uuid;
BEGIN
  IF NOT is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support or admin can issue refunds';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be positive';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF (COALESCE(v_order.refunded_amount, 0) + p_amount) > COALESCE(v_order.total_amount, 0) THEN
    RAISE EXCEPTION 'Refund exceeds order total';
  END IF;

  INSERT INTO refunds (order_id, customer_id, amount, reason, refund_type, notes, issued_by)
  VALUES (p_order_id, v_order.customer_id, p_amount, p_reason, p_refund_type, p_notes, auth.uid())
  RETURNING id INTO v_refund_id;

  UPDATE orders
  SET refunded_amount = COALESCE(refunded_amount, 0) + p_amount,
      refund_reason = COALESCE(p_reason, refund_reason)
  WHERE id = p_order_id;

  -- Audit (admins only — support refunds skip the admin-only audit log)
  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'refund_order',
      'order',
      p_order_id::text,
      'Refunded ' || p_amount || ' (' || COALESCE(p_reason, 'no reason') || ')',
      jsonb_build_object('amount', p_amount, 'type', p_refund_type)
    );
  END IF;

  RETURN v_refund_id;
END;
$$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_orders_group_order_id ON public.orders(group_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for ON public.orders(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_modifiers_item ON public.menu_item_modifiers(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON public.order_item_modifiers(order_item_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON public.refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_fraud_user ON public.fraud_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_group_orders_share ON public.group_orders(share_code);


-- Source: 20260423004614_20ce7fbd-a872-49ed-9889-300b2b874f23.sql
-- Storage bucket for chat attachments (images / gifs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS — bucket is public-read; only authenticated can upload to their own folder
DO $$ BEGIN
  CREATE POLICY "Chat attachments public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users upload chat attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND auth.uid() IS NOT NULL
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own chat attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Attachment columns on chat tables
ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text; -- 'image' | 'gif'

ALTER TABLE public.support_team_messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text;

-- Allow empty message text when an attachment is present
ALTER TABLE public.ticket_messages ALTER COLUMN message DROP NOT NULL;
ALTER TABLE public.support_team_messages ALTER COLUMN message DROP NOT NULL;

-- Source: 20260424001012_37d2fb80-bf12-4b1f-9db4-7994d353fbde.sql
-- Per-store billing configuration for external/manual orders
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS ext_billing_mode text NOT NULL DEFAULT 'commission',
  ADD COLUMN IF NOT EXISTS ext_commission_pct numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ext_flat_fee numeric NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS ext_margin_pct numeric NOT NULL DEFAULT 20;

-- Validate billing mode values via trigger (CHECK constraints would be inflexible)
CREATE OR REPLACE FUNCTION public.validate_store_billing_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ext_billing_mode NOT IN ('commission','flat_fee','driver_plus_margin') THEN
    RAISE EXCEPTION 'Invalid ext_billing_mode: %', NEW.ext_billing_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_store_billing_mode_trg ON public.stores;
CREATE TRIGGER validate_store_billing_mode_trg
BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.validate_store_billing_mode();

-- Track where each order came from + financial breakdown
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS external_ref text,
  ADD COLUMN IF NOT EXISTS store_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_payout numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_profit numeric NOT NULL DEFAULT 0;

-- Validate source via trigger
CREATE OR REPLACE FUNCTION public.validate_order_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source NOT IN ('in_app','manual','efood','wolt','box','other') THEN
    RAISE EXCEPTION 'Invalid order source: %', NEW.source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_order_source_trg ON public.orders;
CREATE TRIGGER validate_order_source_trg
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_order_source();

-- RPC: create an external/manual order with full pricing breakdown
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
  p_items_summary text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store stores%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric;
  v_driver_pay numeric;
  v_store_charge numeric;
  v_profit numeric;
  v_order_id uuid;
  v_combined_notes text;
BEGIN
  IF NOT is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admin or support can create external orders';
  END IF;
  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  SELECT * INTO v_store FROM stores WHERE id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(p_distance_km, 0);

  -- Driver pay: override if provided, otherwise apply rules
  IF p_driver_payout_override IS NOT NULL THEN
    v_driver_pay := p_driver_payout_override;
  ELSE
    v_driver_pay := GREATEST(v_min, v_base + v_per_km * v_km);
  END IF;

  -- Store charge: override or compute from billing mode
  IF p_store_charge_override IS NOT NULL THEN
    v_store_charge := p_store_charge_override;
  ELSE
    CASE v_store.ext_billing_mode
      WHEN 'commission'         THEN v_store_charge := ROUND((p_total_amount * v_store.ext_commission_pct / 100)::numeric, 2);
      WHEN 'flat_fee'           THEN v_store_charge := v_store.ext_flat_fee;
      WHEN 'driver_plus_margin' THEN v_store_charge := ROUND((v_driver_pay * (1 + v_store.ext_margin_pct / 100))::numeric, 2);
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name IS NOT NULL THEN '👤 ' || p_customer_name END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary IS NOT NULL THEN '🧾 ' || p_items_summary END
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
    v_combined_notes, 'external',
    v_store_charge, v_driver_pay, v_profit
  ) RETURNING id INTO v_order_id;

  -- Insert one summary line item so totals show in the queue
  INSERT INTO order_items (order_id, name, quantity, unit_price)
  VALUES (
    v_order_id,
    COALESCE(p_items_summary, 'External order from ' || p_source),
    1,
    p_total_amount
  );

  -- Audit (admins only — support skips the admin-only audit log)
  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'create_external_order',
      'order',
      v_order_id::text,
      'External order from ' || p_source || ' for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$$;

-- Source: 20260424002134_35e30cb2-c45d-4ab4-a291-62a14dff3655.sql
CREATE OR REPLACE FUNCTION public.create_external_order(
  p_store_id uuid,
  p_source text,
  p_total_amount numeric,
  p_delivery_address text,
  p_delivery_lat double precision DEFAULT NULL::double precision,
  p_delivery_lng double precision DEFAULT NULL::double precision,
  p_distance_km numeric DEFAULT NULL::numeric,
  p_customer_name text DEFAULT NULL::text,
  p_customer_phone text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_external_ref text DEFAULT NULL::text,
  p_driver_payout_override numeric DEFAULT NULL::numeric,
  p_store_charge_override numeric DEFAULT NULL::numeric,
  p_items_summary text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_order_id uuid;
  v_combined_notes text;
  v_is_owner boolean := false;
  v_is_priv boolean := false;
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

  -- Store owners may NOT override pricing fields — only admin/support can.
  IF NOT v_is_priv AND (p_driver_payout_override IS NOT NULL OR p_store_charge_override IS NOT NULL) THEN
    RAISE EXCEPTION 'Only admin/support can override pricing';
  END IF;

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = p_store_id;

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
      ELSE                           v_store_charge := ROUND((p_total_amount * 0.15)::numeric, 2);
    END CASE;
  END IF;

  v_profit := v_store_charge - v_driver_pay;

  v_combined_notes := CONCAT_WS(E'\n',
    NULLIF(p_notes, ''),
    CASE WHEN p_customer_name  IS NOT NULL THEN '👤 ' || p_customer_name  END,
    CASE WHEN p_customer_phone IS NOT NULL THEN '📞 ' || p_customer_phone END,
    CASE WHEN p_items_summary  IS NOT NULL THEN '🧾 ' || p_items_summary  END
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
    v_combined_notes, 'external',
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
      'External order from ' || p_source || ' for ' || p_total_amount,
      jsonb_build_object(
        'source', p_source,
        'store_charge', v_store_charge,
        'driver_payout', v_driver_pay,
        'platform_profit', v_profit
      )
    );
  END IF;

  RETURN v_order_id;
END;
$function$;

-- Source: 20260424012051_ffb9e788-bf76-4d78-af29-4dc061e65226.sql
-- Driver offer events: track acceptance / decline / timeout per offer
CREATE TABLE IF NOT EXISTS public.driver_offer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Validate action via trigger (avoid CHECK with non-immutable expressions)
CREATE OR REPLACE FUNCTION public.validate_driver_offer_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.action NOT IN ('accepted','declined','timed_out','viewed') THEN
    RAISE EXCEPTION 'Invalid action: %', NEW.action;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_driver_offer_action_trg ON public.driver_offer_events;
CREATE TRIGGER validate_driver_offer_action_trg
  BEFORE INSERT OR UPDATE ON public.driver_offer_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_driver_offer_action();

CREATE INDEX IF NOT EXISTS idx_driver_offer_events_driver ON public.driver_offer_events(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_offer_events_order ON public.driver_offer_events(order_id);

ALTER TABLE public.driver_offer_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers insert own offer events"
  ON public.driver_offer_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Drivers view own offer events"
  ON public.driver_offer_events FOR SELECT
  TO authenticated
  USING (auth.uid() = driver_id);

CREATE POLICY "Support and admins view all offer events"
  ON public.driver_offer_events FOR SELECT
  TO authenticated
  USING (public.is_support_or_admin(auth.uid()));


-- Source: 20260424020527_6d08a7c8-49e3-4555-9dea-85a34efa9822.sql

-- Add dispatch timing fields to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispatch_at timestamptz,
  ADD COLUMN IF NOT EXISTS predicted_prep_minutes integer;

CREATE INDEX IF NOT EXISTS idx_orders_dispatch_at ON public.orders(dispatch_at) WHERE dispatch_at IS NOT NULL;

-- Helper function: get historical avg prep time per store (last 30 delivered orders)
CREATE OR REPLACE FUNCTION public.get_store_avg_prep_minutes(p_store_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (
      (SELECT MIN(updated_at) FROM orders o2 WHERE o2.id = o.id AND o2.status = 'ready')
      - o.created_at
    )) / 60.0)::numeric,
    20
  )
  FROM (
    SELECT id, created_at, store_id, status
    FROM orders
    WHERE store_id = p_store_id
      AND status = 'delivered'
    ORDER BY created_at DESC
    LIMIT 30
  ) o;
$$;

-- Function to set dispatch timing — called from edge function via service role
CREATE OR REPLACE FUNCTION public.set_order_dispatch(
  p_order_id uuid,
  p_dispatch_at timestamptz,
  p_predicted_prep_minutes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE orders
  SET dispatch_at = p_dispatch_at,
      predicted_prep_minutes = p_predicted_prep_minutes
  WHERE id = p_order_id;
END;
$$;


-- Source: 20260424022358_96670abb-d765-476a-8da9-89d474370e92.sql
-- 1. Customer wallets
CREATE TABLE IF NOT EXISTS public.customer_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  balance NUMERIC NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_credit NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own wallet"
  ON public.customer_wallets FOR SELECT
  USING (auth.uid() = user_id OR is_support_or_admin(auth.uid()));

CREATE POLICY "Support/admin manage wallets"
  ON public.customer_wallets FOR ALL
  USING (is_support_or_admin(auth.uid()))
  WITH CHECK (is_support_or_admin(auth.uid()));

CREATE TRIGGER update_customer_wallets_updated_at
  BEFORE UPDATE ON public.customer_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Wallet ledger
CREATE TABLE IF NOT EXISTS public.customer_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('refund_credit','referral_bonus','order_redemption','admin_adjust','signup_bonus')),
  description TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own ledger"
  ON public.customer_wallet_ledger FOR SELECT
  USING (auth.uid() = user_id OR is_support_or_admin(auth.uid()));

CREATE POLICY "Support/admin insert ledger"
  ON public.customer_wallet_ledger FOR INSERT
  WITH CHECK (is_support_or_admin(auth.uid()));

-- 3. Customer referrals
CREATE TABLE IF NOT EXISTS public.customer_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  referred_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  reward_amount NUMERIC NOT NULL DEFAULT 5,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own referrals"
  ON public.customer_referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id OR is_support_or_admin(auth.uid()));

CREATE POLICY "Customers create own referral codes"
  ON public.customer_referrals FOR INSERT
  WITH CHECK (auth.uid() = referrer_id);

CREATE POLICY "Support/admin update referrals"
  ON public.customer_referrals FOR UPDATE
  USING (is_support_or_admin(auth.uid()))
  WITH CHECK (is_support_or_admin(auth.uid()));

-- 4. Allergens & nutrition on menu items
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS allergens TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS calories INTEGER,
  ADD COLUMN IF NOT EXISTS is_vegetarian BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vegan BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_gluten_free BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS spicy_level SMALLINT DEFAULT 0 CHECK (spicy_level BETWEEN 0 AND 3);

-- 5. Stacked orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stacked_with_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

-- 6. Helper: redeem wallet credit (used by checkout)
CREATE OR REPLACE FUNCTION public.redeem_wallet_credit(p_amount NUMERIC, p_order_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_redeem NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_amount <= 0 THEN
    RETURN 0;
  END IF;

  SELECT balance INTO v_balance FROM customer_wallets WHERE user_id = auth.uid();
  IF v_balance IS NULL OR v_balance <= 0 THEN
    RETURN 0;
  END IF;

  v_redeem := LEAST(v_balance, p_amount);

  UPDATE customer_wallets
  SET balance = balance - v_redeem
  WHERE user_id = auth.uid();

  INSERT INTO customer_wallet_ledger (user_id, amount, type, description, order_id)
  VALUES (auth.uid(), -v_redeem, 'order_redemption', 'Used wallet credit on order', p_order_id);

  RETURN v_redeem;
END;
$$;

-- 7. Helper: credit referral bonus (admin/support)
CREATE OR REPLACE FUNCTION public.credit_customer_wallet(p_user_id UUID, p_amount NUMERIC, p_type TEXT, p_description TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support/admin can credit wallets';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  INSERT INTO customer_wallets (user_id, balance, lifetime_credit)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = customer_wallets.balance + p_amount,
        lifetime_credit = customer_wallets.lifetime_credit + p_amount,
        updated_at = now();

  INSERT INTO customer_wallet_ledger (user_id, amount, type, description)
  VALUES (p_user_id, p_amount, p_type, p_description);
END;
$$;

-- Source: 20260424032606_1b322443-beed-4a6d-b4d4-167a35cb6072.sql
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

-- Source: 20260424032928_354b56c8-b532-48ad-87b5-28b487f55654.sql
CREATE OR REPLACE FUNCTION public.admin_reset_driver_wallet(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prev_available numeric;
  v_prev_pending numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reset driver wallet';
  END IF;

  SELECT available_balance, pending_balance
    INTO v_prev_available, v_prev_pending
  FROM public.driver_wallets
  WHERE driver_id = p_driver_id;

  INSERT INTO public.driver_wallets (driver_id, available_balance, pending_balance)
  VALUES (p_driver_id, 0, 0)
  ON CONFLICT (driver_id) DO UPDATE
    SET available_balance = 0,
        pending_balance = 0,
        updated_at = now();

  -- Log a debit transaction so history reflects the reset
  IF COALESCE(v_prev_available, 0) > 0 OR COALESCE(v_prev_pending, 0) > 0 THEN
    INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (
      p_driver_id,
      'admin_debit',
      -1 * COALESCE(v_prev_available, 0) - COALESCE(v_prev_pending, 0),
      'completed',
      'Admin reset wallet to 0'
    );
  END IF;

  PERFORM public.log_admin_action(
    'reset_driver_wallet',
    'driver',
    p_driver_id::text,
    'Μηδένισε πορτοφόλι οδηγού',
    jsonb_build_object(
      'previous_available', COALESCE(v_prev_available, 0),
      'previous_pending', COALESCE(v_prev_pending, 0)
    )
  );
END;
$$;

-- Source: 20260424033752_c29264c0-3f27-4b08-a70f-7383d0a25589.sql
CREATE OR REPLACE FUNCTION public.admin_wipe_all_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can wipe data';
  END IF;

  DELETE FROM public.order_item_modifiers;
  DELETE FROM public.order_items;
  DELETE FROM public.earnings;
  DELETE FROM public.refunds;
  DELETE FROM public.reviews;
  DELETE FROM public.driver_offer_events;
  DELETE FROM public.orders;

  DELETE FROM public.menu_item_modifiers;
  DELETE FROM public.menu_items;
  DELETE FROM public.promo_codes;
  DELETE FROM public.announcements;
  DELETE FROM public.demand_zones;
  DELETE FROM public.surge_zones;
  DELETE FROM public.canned_replies;

  DELETE FROM public.customer_wallet_ledger;
  DELETE FROM public.customer_favorites;
  DELETE FROM public.customer_referrals;
  DELETE FROM public.reward_history;
  DELETE FROM public.saved_addresses;
  DELETE FROM public.group_order_participants;
  DELETE FROM public.group_orders;

  DELETE FROM public.ticket_messages;
  DELETE FROM public.support_tickets;
  DELETE FROM public.support_team_messages;
  DELETE FROM public.fraud_signals;

  DELETE FROM public.driver_locations;
  DELETE FROM public.wallet_transactions;
  DELETE FROM public.driver_referrals;
  DELETE FROM public.wait_time_bonuses;

  UPDATE public.driver_wallets SET available_balance = 0, pending_balance = 0, total_withdrawn = 0;
  UPDATE public.driver_state SET shift_cash_balance = 0, shift_started_at = NULL, on_break = false, break_until = NULL;
  UPDATE public.customer_wallets SET balance = 0, lifetime_credit = 0;
  UPDATE public.customer_rewards SET points = 0, lifetime_points = 0, tier = 'bronze';

  PERFORM public.log_admin_action(
    'wipe_all_data',
    'platform',
    NULL,
    'Διαγράφηκαν όλα τα δεδομένα και μηδενίστηκαν οι μετρητές',
    '{}'::jsonb
  );
END;
$$;

-- Source: 20260424112708_c7723a6a-afbc-470d-8789-b784832d9bbe.sql

-- 1. Driver notifications table
CREATE TABLE public.driver_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  sender_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers read own notifications"
  ON public.driver_notifications FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "Drivers mark own notifications read"
  ON public.driver_notifications FOR UPDATE
  USING (auth.uid() = driver_id);

CREATE POLICY "Support/admin send notifications"
  ON public.driver_notifications FOR INSERT
  WITH CHECK (public.is_support_or_admin(auth.uid()));

CREATE POLICY "Support/admin view notifications"
  ON public.driver_notifications FOR SELECT
  USING (public.is_support_or_admin(auth.uid()));

CREATE INDEX idx_driver_notifications_driver_unread
  ON public.driver_notifications(driver_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_notifications;

-- 2. RPC: support_credit_wallet (capped €20)
CREATE OR REPLACE FUNCTION public.support_credit_wallet(
  p_driver_id uuid,
  p_amount numeric,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount <= 0 OR p_amount > 20 THEN
    RAISE EXCEPTION 'Amount must be between 0 and 20';
  END IF;

  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
    ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET available_balance = available_balance + p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (p_driver_id, 'support_credit', p_amount, 'completed', COALESCE(p_reason, 'Support credit'));
END;
$$;

-- 3. RPC: support_grant_bonus (capped €10)
CREATE OR REPLACE FUNCTION public.support_grant_bonus(
  p_driver_id uuid,
  p_amount numeric,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_amount <= 0 OR p_amount > 10 THEN
    RAISE EXCEPTION 'Bonus must be between 0 and 10';
  END IF;

  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
    ON CONFLICT (driver_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET available_balance = available_balance + p_amount,
        updated_at = now()
    WHERE driver_id = p_driver_id;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
    VALUES (p_driver_id, 'support_bonus', p_amount, 'completed', COALESCE(p_reason, 'Support bonus'));
END;
$$;

-- 4. RPC: support_suspend_driver (bypasses admin-only trigger via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.support_suspend_driver(
  p_driver_id uuid,
  p_reason text,
  p_suspend boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.driver_profiles
    SET is_active = NOT p_suspend,
        suspended_at = CASE WHEN p_suspend THEN now() ELSE NULL END,
        suspension_reason = CASE WHEN p_suspend THEN COALESCE(p_reason, 'Suspended by support') ELSE NULL END,
        updated_at = now()
    WHERE user_id = p_driver_id;
END;
$$;

-- 5. RPC: support_unassign_order (return to dispatch)
CREATE OR REPLACE FUNCTION public.support_unassign_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.orders
    SET driver_id = NULL,
        status = 'ready',
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;


-- Source: 20260425001008_9c15ca44-1d0e-4c6a-94e1-96615f03ad41.sql
-- =========================================================
-- Money Bags: Stores, Admin Treasury, Driver Cash Debts
-- =========================================================

-- ---------- STORE WALLETS ----------
CREATE TABLE IF NOT EXISTS public.store_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE,
  available_balance numeric NOT NULL DEFAULT 0,
  pending_balance numeric NOT NULL DEFAULT 0,
  lifetime_earnings numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Store owners view own wallet"
  ON public.store_wallets FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_wallets.store_id AND s.owner_id = auth.uid()));

CREATE POLICY "Admins view all store wallets"
  ON public.store_wallets FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage store wallets"
  ON public.store_wallets FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER store_wallets_updated
  BEFORE UPDATE ON public.store_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- STORE WALLET LEDGER ----------
CREATE TABLE IF NOT EXISTS public.store_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  order_id uuid,
  type text NOT NULL,        -- order_earning, payout, adjustment, cash_settled
  amount numeric NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.store_wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Store owners view own ledger"
  ON public.store_wallet_ledger FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_wallet_ledger.store_id AND s.owner_id = auth.uid()));

CREATE POLICY "Admins manage store ledger"
  ON public.store_wallet_ledger FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_store_ledger_store ON public.store_wallet_ledger(store_id, created_at DESC);

-- ---------- ADMIN TREASURY (single platform money bag) ----------
CREATE TABLE IF NOT EXISTS public.admin_treasury (
  id integer PRIMARY KEY DEFAULT 1,
  admin_balance numeric NOT NULL DEFAULT 0,         -- 5% admin cut
  platform_pool numeric NOT NULL DEFAULT 0,         -- 10% remaining commission (used to top-up drivers)
  lifetime_admin_earned numeric NOT NULL DEFAULT 0,
  lifetime_platform_earned numeric NOT NULL DEFAULT 0,
  lifetime_driver_topup numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

INSERT INTO public.admin_treasury (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.admin_treasury ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view treasury"
  ON public.admin_treasury FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update treasury"
  ON public.admin_treasury FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- ADMIN TREASURY LEDGER ----------
CREATE TABLE IF NOT EXISTS public.admin_treasury_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  type text NOT NULL,        -- admin_fee, platform_fee, driver_topup, store_payout, cash_settled, adjustment
  bag text NOT NULL,         -- 'admin' or 'platform'
  amount numeric NOT NULL,   -- positive = credit, negative = debit
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.admin_treasury_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage treasury ledger"
  ON public.admin_treasury_ledger FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_treasury_ledger_created ON public.admin_treasury_ledger(created_at DESC);

-- ---------- DRIVER CASH DEBTS ----------
CREATE TABLE IF NOT EXISTS public.driver_cash_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  order_id uuid,
  cash_collected numeric NOT NULL DEFAULT 0,    -- total cash driver received from customer
  driver_share numeric NOT NULL DEFAULT 0,      -- driver's earnings (kept from the cash)
  store_share numeric NOT NULL DEFAULT 0,       -- owed to store
  admin_share numeric NOT NULL DEFAULT 0,       -- owed to admin (5%)
  platform_share numeric NOT NULL DEFAULT 0,    -- owed to platform pool (10% minus topup)
  amount_owed numeric NOT NULL DEFAULT 0,       -- = store + admin + platform
  settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  settled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_cash_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers view own debts"
  ON public.driver_cash_debts FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "Admins manage cash debts"
  ON public.driver_cash_debts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Support view cash debts"
  ON public.driver_cash_debts FOR SELECT
  USING (public.is_support_or_admin(auth.uid()));

CREATE INDEX idx_cash_debts_driver ON public.driver_cash_debts(driver_id, settled, created_at DESC);

-- =========================================================
-- SETTLEMENT FUNCTION (runs on order delivered)
-- =========================================================
CREATE OR REPLACE FUNCTION public.settle_order_money_bags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_food_total numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_min_pay numeric;
  v_settings platform_settings%ROWTYPE;
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_amount_owed numeric;
BEGIN
  -- Only on transition to delivered
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Skip if already settled (re-trigger safety)
  IF EXISTS (SELECT 1 FROM store_wallet_ledger WHERE order_id = NEW.id AND type = 'order_earning') THEN
    RETURN NEW;
  END IF;

  v_food_total := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip := COALESCE(NEW.tip_amount, 0);
  v_is_cash := (NEW.payment_method = 'cash');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay := COALESCE(v_settings.min_pay, 3);

  -- 15% commission split: 5% admin + 10% platform pool
  v_total_commission := ROUND(v_food_total * 0.15, 2);
  v_admin_cut := ROUND(v_food_total * 0.05, 2);
  v_platform_cut := v_total_commission - v_admin_cut;
  v_store_share := v_food_total - v_total_commission;

  -- Driver fairness: driver should get max(min_pay, delivery_fee + tip)
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    -- Top-up comes out of platform pool first
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  -- ---- STORE WALLET ----
  INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
  VALUES (NEW.store_id, v_store_share, v_store_share)
  ON CONFLICT (store_id) DO UPDATE
    SET available_balance = store_wallets.available_balance + v_store_share,
        lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
        updated_at = now();

  INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
  VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
          'Order ' || COALESCE(NEW.external_ref, NEW.id::text) || ' (85% of ' || v_food_total || ')');

  -- ---- ADMIN TREASURY ----
  UPDATE admin_treasury
    SET admin_balance = admin_balance + v_admin_cut,
        platform_pool = platform_pool + v_platform_cut,
        lifetime_admin_earned = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut, '5% admin cut');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          '10% platform pool' || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ driver top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup, 'Top-up to guarantee fair driver pay');
  END IF;

  -- ---- DRIVER WALLET (always fair pay) ----
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance) VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay (delivery ' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- ---- CASH HANDLING ----
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    -- Driver pocketed the cash. They owe back: store + admin + platform (minus their own share already covered by cash)
    -- Cash collected = food_total + delivery_fee. Driver keeps v_driver_target. Owes the rest.
    v_amount_owed := (v_food_total + v_delivery_fee) - v_driver_target;
    INSERT INTO driver_cash_debts (
      driver_id, order_id, cash_collected, driver_share,
      store_share, admin_share, platform_share, amount_owed
    ) VALUES (
      NEW.driver_id, NEW.id, v_food_total + v_delivery_fee, v_driver_target,
      v_store_share, v_admin_cut, GREATEST(v_platform_cut, 0), v_amount_owed
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settle_money_bags_on_delivery ON public.orders;
CREATE TRIGGER settle_money_bags_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_order_money_bags();

-- =========================================================
-- ADMIN ACTIONS: settle cash debt, payout store
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_settle_driver_cash(p_debt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_debt driver_cash_debts%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can settle cash';
  END IF;
  SELECT * INTO v_debt FROM driver_cash_debts WHERE id = p_debt_id AND NOT settled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Debt not found or already settled'; END IF;

  -- Move cash into the proper bags
  UPDATE admin_treasury
    SET admin_balance = admin_balance + v_debt.admin_share,
        platform_pool = platform_pool + v_debt.platform_share,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (v_debt.order_id, 'cash_settled', 'admin', v_debt.admin_share, 'Cash settlement from driver'),
         (v_debt.order_id, 'cash_settled', 'platform', v_debt.platform_share, 'Cash settlement from driver');

  INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description, created_by)
  SELECT o.store_id, v_debt.order_id, 'cash_settled', v_debt.store_share,
         'Cash from driver settlement', auth.uid()
  FROM orders o WHERE o.id = v_debt.order_id;

  -- Reset driver shift cash (admin acknowledges receipt)
  UPDATE driver_state
    SET shift_cash_balance = GREATEST(0, shift_cash_balance - v_debt.amount_owed),
        updated_at = now()
    WHERE driver_id = v_debt.driver_id;

  UPDATE driver_cash_debts
    SET settled = true, settled_at = now(), settled_by = auth.uid()
    WHERE id = p_debt_id;

  PERFORM log_admin_action('settle_driver_cash', 'driver', v_debt.driver_id::text,
    'Settled ' || v_debt.amount_owed || '€ cash debt', jsonb_build_object('debt_id', p_debt_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_payout_store(p_store_id uuid, p_amount numeric, p_description text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can pay out stores';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT available_balance INTO v_balance FROM store_wallets WHERE store_id = p_store_id;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient store balance';
  END IF;

  UPDATE store_wallets
    SET available_balance = available_balance - p_amount,
        updated_at = now()
    WHERE store_id = p_store_id;

  INSERT INTO store_wallet_ledger (store_id, type, amount, description, created_by)
  VALUES (p_store_id, 'payout', -p_amount, COALESCE(p_description, 'Admin payout'), auth.uid());

  PERFORM log_admin_action('payout_store', 'store', p_store_id::text,
    'Paid out ' || p_amount || '€ to store', '{}'::jsonb);
END;
$$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_treasury;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_cash_debts;


-- Source: 20260425001712_323bf18e-23d4-4e88-9b14-58a49853a193.sql
CREATE OR REPLACE FUNCTION public.settle_order_money_bags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_food_total numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_min_pay numeric;
  v_settings platform_settings%ROWTYPE;
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_amount_owed numeric;
  v_is_external boolean;
  v_store_charge numeric;
  v_base numeric;
  v_label text;
BEGIN
  -- Only on transition to delivered
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Skip if already settled
  IF EXISTS (SELECT 1 FROM store_wallet_ledger WHERE order_id = NEW.id AND type IN ('order_earning','external_charge')) THEN
    RETURN NEW;
  END IF;

  v_food_total   := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip          := COALESCE(NEW.tip_amount, 0);
  v_store_charge := COALESCE(NEW.store_charge, 0);
  v_is_cash      := (NEW.payment_method = 'cash');
  v_is_external  := (COALESCE(NEW.source, 'in_app') <> 'in_app');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay := COALESCE(v_settings.min_pay, 3);

  -- ============================================================
  -- Choose the base amount the 85/5/10 split applies to:
  --   in-app   → total_amount (food)
  --   external → store_charge (what we bill the store)
  -- ============================================================
  v_base := CASE WHEN v_is_external THEN v_store_charge ELSE v_food_total END;

  v_total_commission := ROUND(v_base * 0.15, 2);
  v_admin_cut        := ROUND(v_base * 0.05, 2);
  v_platform_cut     := v_total_commission - v_admin_cut;
  v_store_share      := v_base - v_total_commission;

  -- Driver fairness: max(min_pay, delivery_fee + tip)
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  v_label := CASE WHEN v_is_external THEN UPPER(NEW.source) ELSE 'in-app' END;

  -- ============================================================
  -- STORE WALLET
  --   in-app   → CREDIT 85% of food_total (we owe store)
  --   external → DEBIT full store_charge (store owes platform for service)
  -- ============================================================
  IF v_is_external THEN
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, -v_store_charge, 0)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance - v_store_charge,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'external_charge', -v_store_charge,
            v_label || ' delivery fee charged to store ('
            || COALESCE(NEW.external_ref, NEW.id::text) || ')');
  ELSE
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, v_store_share, v_store_share)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance + v_store_share,
          lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
            'In-app order ' || COALESCE(NEW.external_ref, NEW.id::text) || ' (85% of ' || v_food_total || ')');
  END IF;

  -- ============================================================
  -- ADMIN TREASURY (same logic for both, base differs)
  -- ============================================================
  UPDATE admin_treasury
    SET admin_balance = admin_balance + v_admin_cut,
        platform_pool = platform_pool + v_platform_cut,
        lifetime_admin_earned = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut, '5% admin cut [' || v_label || ']');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          '10% platform pool [' || v_label || ']'
          || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ driver top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup,
            'Top-up to guarantee fair driver pay [' || v_label || ']');
  END IF;

  -- ============================================================
  -- DRIVER WALLET (always fair pay)
  -- ============================================================
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance) VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay [' || v_label || '] (delivery ' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- ============================================================
  -- CASH HANDLING
  --   in-app cash:   driver collected food + delivery, owes back (food + delivery − fair pay)
  --   external cash: driver collected food, owes back (food − fair pay) — store_charge stays as store debt
  -- ============================================================
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    IF v_is_external THEN
      v_amount_owed := v_food_total - v_driver_target;
    ELSE
      v_amount_owed := (v_food_total + v_delivery_fee) - v_driver_target;
    END IF;

    IF v_amount_owed > 0 THEN
      INSERT INTO driver_cash_debts (
        driver_id, order_id, cash_collected, driver_share,
        store_share, admin_share, platform_share, amount_owed
      ) VALUES (
        NEW.driver_id, NEW.id,
        CASE WHEN v_is_external THEN v_food_total ELSE v_food_total + v_delivery_fee END,
        v_driver_target,
        CASE WHEN v_is_external THEN 0 ELSE v_store_share END,
        v_admin_cut,
        GREATEST(v_platform_cut, 0),
        v_amount_owed
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Source: 20260426005707_13eb95c3-38ff-43ca-89bb-fd8b70b021c2.sql
-- ============================================================
-- SUPPORT: cancel & modify orders
-- (creating handled via existing create_external_order which
-- already authorizes is_support_or_admin)
-- ============================================================

-- 1. Cancel an order (refund driver fair-pay reversal if delivered? NO —
--    cancel only allowed if NOT yet delivered; reverse settlement is too risky.)
CREATE OR REPLACE FUNCTION public.support_cancel_order(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support or admin can cancel orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.status = 'delivered' THEN
    RAISE EXCEPTION 'Cannot cancel a delivered order — issue a refund instead';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled';
  END IF;

  UPDATE orders
    SET status = 'cancelled',
        notes = CASE
          WHEN p_reason IS NOT NULL AND p_reason <> ''
            THEN COALESCE(notes || E'\n', '') || '❌ Cancelled by support: ' || p_reason
          ELSE notes
        END,
        updated_at = now()
    WHERE id = p_order_id;

  -- Audit (admin-only audit log helper safely no-ops for support since
  -- log_admin_action requires admin; wrap in IF)
  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'cancel_order', 'order', p_order_id::text,
      'Cancelled order: ' || COALESCE(p_reason, 'no reason'),
      jsonb_build_object('reason', p_reason)
    );
  END IF;
END;
$$;

-- 2. Modify an order's editable fields
--    Allowed fields: total_amount, delivery_fee, tip_amount, delivery_address,
--    delivery_lat/lng, notes. Forbidden: store_id, customer_id, driver_id,
--    status (use dedicated RPCs for those).
CREATE OR REPLACE FUNCTION public.support_modify_order(
  p_order_id uuid,
  p_total_amount numeric DEFAULT NULL,
  p_delivery_fee numeric DEFAULT NULL,
  p_tip_amount numeric DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_change_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only support or admin can modify orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot modify a % order', v_order.status;
  END IF;

  IF p_total_amount IS NOT NULL AND p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;
  IF p_delivery_fee IS NOT NULL AND p_delivery_fee < 0 THEN
    RAISE EXCEPTION 'Delivery fee cannot be negative';
  END IF;
  IF p_tip_amount IS NOT NULL AND p_tip_amount < 0 THEN
    RAISE EXCEPTION 'Tip cannot be negative';
  END IF;

  UPDATE orders SET
    total_amount      = COALESCE(p_total_amount,      total_amount),
    delivery_fee      = COALESCE(p_delivery_fee,      delivery_fee),
    tip_amount        = COALESCE(p_tip_amount,        tip_amount),
    delivery_address  = COALESCE(p_delivery_address,  delivery_address),
    delivery_latitude  = COALESCE(p_delivery_lat,     delivery_latitude),
    delivery_longitude = COALESCE(p_delivery_lng,     delivery_longitude),
    notes = CASE
      WHEN p_change_reason IS NOT NULL AND p_change_reason <> ''
        THEN COALESCE(notes || E'\n', '') || '✏️ Modified by support: ' || p_change_reason
      WHEN p_notes IS NOT NULL THEN p_notes
      ELSE notes
    END,
    updated_at = now()
  WHERE id = p_order_id;

  v_changes := jsonb_build_object(
    'total_amount', p_total_amount,
    'delivery_fee', p_delivery_fee,
    'tip_amount', p_tip_amount,
    'delivery_address', p_delivery_address,
    'reason', p_change_reason
  );

  IF has_role(auth.uid(), 'admin') THEN
    PERFORM log_admin_action(
      'modify_order', 'order', p_order_id::text,
      'Modified order' || COALESCE(' — ' || p_change_reason, ''),
      v_changes
    );
  END IF;
END;
$$;

-- protect_order_financials trigger blocks non-admin financial edits;
-- our SECURITY DEFINER RPCs run as owner so they bypass that check —
-- which is the intended behaviour for support cancellations/modifications.

-- Source: 20260427000237_61479aed-0d4c-4fe9-b08a-c299f2fe3ad2.sql
-- =========================================================
-- Simplified Money Handling
--   * Commission: global default % + optional per-store override
--   * Admin cut : configurable % of commission (rest -> platform pool)
--   * Cash      : driver owes admin the FULL cash amount;
--                 driver payout credited to wallet just like card
-- =========================================================

-- 1) Per-store commission override (nullable -> use global default)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS commission_pct numeric;

COMMENT ON COLUMN public.stores.commission_pct
  IS 'Per-store in-app commission % override. NULL = use platform_settings.default_commission_pct.';

-- 2) Configurable admin share (% of total commission going to admin bag)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS admin_share_pct numeric NOT NULL DEFAULT 33.33;

COMMENT ON COLUMN public.platform_settings.admin_share_pct
  IS '% of the commission that goes to admin bag. Remainder goes to platform pool. Default 33.33 means 5%/15% admin/platform when commission is 15%.';

-- 3) Rewrite settlement trigger to use the new model
CREATE OR REPLACE FUNCTION public.settle_order_money_bags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_food_total numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_min_pay numeric;
  v_settings platform_settings%ROWTYPE;
  v_commission_pct numeric;
  v_admin_share_pct numeric;
  v_store_commission_override numeric;
  v_store_share numeric;
  v_total_commission numeric;
  v_admin_cut numeric;
  v_platform_cut numeric;
  v_driver_target numeric;
  v_driver_paid_from_fee numeric;
  v_driver_topup numeric := 0;
  v_is_cash boolean;
  v_is_external boolean;
  v_store_charge numeric;
  v_base numeric;
  v_label text;
  v_cash_owed numeric;
BEGIN
  -- Only on transition to delivered
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Skip if already settled
  IF EXISTS (
    SELECT 1 FROM store_wallet_ledger
    WHERE order_id = NEW.id AND type IN ('order_earning','external_charge')
  ) THEN
    RETURN NEW;
  END IF;

  v_food_total   := COALESCE(NEW.total_amount, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee, 0);
  v_tip          := COALESCE(NEW.tip_amount, 0);
  v_store_charge := COALESCE(NEW.store_charge, 0);
  v_is_cash      := (NEW.payment_method = 'cash');
  v_is_external  := (COALESCE(NEW.source, 'in_app') <> 'in_app');

  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  v_min_pay         := COALESCE(v_settings.min_pay, 3);
  v_admin_share_pct := COALESCE(v_settings.admin_share_pct, 33.33);

  -- Per-store commission override (NULL -> global default)
  SELECT commission_pct INTO v_store_commission_override
    FROM stores WHERE id = NEW.store_id;
  v_commission_pct := COALESCE(v_store_commission_override, v_settings.default_commission_pct, 15);

  -- Base amount the commission applies to
  v_base := CASE WHEN v_is_external THEN v_store_charge ELSE v_food_total END;

  v_total_commission := ROUND(v_base * (v_commission_pct / 100.0), 2);
  v_admin_cut        := ROUND(v_total_commission * (v_admin_share_pct / 100.0), 2);
  v_platform_cut     := v_total_commission - v_admin_cut;
  v_store_share      := v_base - v_total_commission;

  -- Driver fairness top-up (out of platform pool)
  v_driver_paid_from_fee := v_delivery_fee + v_tip;
  v_driver_target        := GREATEST(v_min_pay, v_driver_paid_from_fee);
  IF v_driver_target > v_driver_paid_from_fee THEN
    v_driver_topup := v_driver_target - v_driver_paid_from_fee;
    v_platform_cut := v_platform_cut - v_driver_topup;
  END IF;

  v_label := CASE WHEN v_is_external THEN UPPER(NEW.source) ELSE 'in-app' END;

  -- ---------- STORE WALLET ----------
  IF v_is_external THEN
    -- External orders: store owes platform the delivery service charge
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, -v_store_charge, 0)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance - v_store_charge,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'external_charge', -v_store_charge,
            v_label || ' delivery fee (' || COALESCE(NEW.external_ref, NEW.id::text) || ')');
  ELSE
    -- In-app: store keeps (100 - commission)% of food
    INSERT INTO store_wallets (store_id, available_balance, lifetime_earnings)
    VALUES (NEW.store_id, v_store_share, v_store_share)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = store_wallets.available_balance + v_store_share,
          lifetime_earnings = store_wallets.lifetime_earnings + v_store_share,
          updated_at = now();

    INSERT INTO store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (NEW.store_id, NEW.id, 'order_earning', v_store_share,
            'Order ' || COALESCE(NEW.external_ref, NEW.id::text)
            || ' (' || (100 - v_commission_pct) || '% of ' || v_food_total || ')');
  END IF;

  -- ---------- ADMIN TREASURY ----------
  UPDATE admin_treasury
    SET admin_balance            = admin_balance + v_admin_cut,
        platform_pool            = platform_pool + v_platform_cut,
        lifetime_admin_earned    = lifetime_admin_earned + v_admin_cut,
        lifetime_platform_earned = lifetime_platform_earned + GREATEST(v_platform_cut, 0),
        lifetime_driver_topup    = lifetime_driver_topup + v_driver_topup,
        updated_at = now()
    WHERE id = 1;

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'admin_fee', 'admin', v_admin_cut,
          'Admin cut ' || v_admin_share_pct || '% of ' || v_commission_pct || '% commission [' || v_label || ']');

  INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
  VALUES (NEW.id, 'platform_fee', 'platform', v_platform_cut,
          'Platform pool [' || v_label || ']'
          || CASE WHEN v_driver_topup > 0 THEN ' (after ' || v_driver_topup || '€ top-up)' ELSE '' END);

  IF v_driver_topup > 0 THEN
    INSERT INTO admin_treasury_ledger (order_id, type, bag, amount, description)
    VALUES (NEW.id, 'driver_topup', 'platform', -v_driver_topup,
            'Driver fair-pay top-up [' || v_label || ']');
  END IF;

  -- ---------- DRIVER WALLET (always credit fair pay) ----------
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO driver_wallets (driver_id, available_balance)
    VALUES (NEW.driver_id, v_driver_target)
    ON CONFLICT (driver_id) DO UPDATE
      SET available_balance = driver_wallets.available_balance + v_driver_target,
          updated_at = now();

    INSERT INTO wallet_transactions (driver_id, type, amount, status, description, order_id)
    VALUES (NEW.driver_id, 'earning_credit', v_driver_target, 'completed',
            'Fair pay [' || v_label || '] (' || v_driver_paid_from_fee || '€'
            || CASE WHEN v_driver_topup > 0 THEN ' + ' || v_driver_topup || '€ top-up' ELSE '' END || ')',
            NEW.id);
  END IF;

  -- ---------- CASH HANDLING (SIMPLIFIED) ----------
  -- Driver hands ALL collected cash to admin. One number to settle.
  IF v_is_cash AND NEW.driver_id IS NOT NULL THEN
    IF v_is_external THEN
      v_cash_owed := v_food_total;                       -- only food collected for external
    ELSE
      v_cash_owed := v_food_total + v_delivery_fee;      -- food + delivery for in-app
    END IF;

    IF v_cash_owed > 0 THEN
      INSERT INTO driver_cash_debts (
        driver_id, order_id, cash_collected,
        driver_share, store_share, admin_share, platform_share,
        amount_owed
      ) VALUES (
        NEW.driver_id, NEW.id, v_cash_owed,
        0,                                 -- driver paid via wallet, not from cash
        CASE WHEN v_is_external THEN 0 ELSE v_store_share END,
        v_admin_cut,
        GREATEST(v_platform_cut, 0),
        v_cash_owed                        -- driver owes the full cash to admin
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

