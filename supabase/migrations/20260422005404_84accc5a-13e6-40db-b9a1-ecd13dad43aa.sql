
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
