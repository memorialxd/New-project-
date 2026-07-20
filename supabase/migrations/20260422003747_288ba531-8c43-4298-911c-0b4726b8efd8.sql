
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
