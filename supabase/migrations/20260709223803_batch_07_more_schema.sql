-- Source: 20260406224431_57212014-da85-4af0-a155-70d7afa4cf48.sql

ALTER TABLE public.stores DISABLE TRIGGER protect_store_active;

UPDATE public.stores SET is_active = false 
WHERE name IN ('Souvlaki House', 'Pizza Napoli', 'Μπουγάτσα Θεσσαλονίκη', 'Burger Lab', 'Sushi Master', 'Κρεπερί La Crêpe', 'Τα Ψητά του Μάκη', 'Wok & Roll');

ALTER TABLE public.stores ENABLE TRIGGER protect_store_active;


-- Source: 20260406230521_471a7eed-ad1e-46b1-95f2-0b43da9065e2.sql

DROP POLICY IF EXISTS "Drivers can insert own driver profile" ON public.driver_profiles;
CREATE POLICY "Drivers can insert own driver profile"
ON public.driver_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_role(auth.uid(), 'driver'::app_role));

DROP POLICY IF EXISTS "Drivers can claim unassigned orders" ON public.orders;
CREATE POLICY "Drivers can claim unassigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  driver_id IS NULL
  AND public.has_role(auth.uid(), 'driver'::app_role)
)
WITH CHECK (
  driver_id = auth.uid()
  AND public.has_role(auth.uid(), 'driver'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.is_active = true
  )
);

DROP POLICY IF EXISTS "Drivers can update assigned orders" ON public.orders;
CREATE POLICY "Drivers can update assigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id)
WITH CHECK (
  auth.uid() = driver_id
  AND NOT (total_amount IS DISTINCT FROM (SELECT o.total_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (delivery_fee IS DISTINCT FROM (SELECT o.delivery_fee FROM orders o WHERE o.id = orders.id))
  AND NOT (tip_amount IS DISTINCT FROM (SELECT o.tip_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (customer_id IS DISTINCT FROM (SELECT o.customer_id FROM orders o WHERE o.id = orders.id))
  AND NOT (store_id IS DISTINCT FROM (SELECT o.store_id FROM orders o WHERE o.id = orders.id))
);

DROP POLICY IF EXISTS "Store owners can update store orders" ON public.orders;
CREATE POLICY "Store owners can update store orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
  )
)
WITH CHECK (
  NOT (total_amount IS DISTINCT FROM (SELECT o.total_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (delivery_fee IS DISTINCT FROM (SELECT o.delivery_fee FROM orders o WHERE o.id = orders.id))
  AND NOT (tip_amount IS DISTINCT FROM (SELECT o.tip_amount FROM orders o WHERE o.id = orders.id))
  AND NOT (customer_id IS DISTINCT FROM (SELECT o.customer_id FROM orders o WHERE o.id = orders.id))
);

DROP POLICY IF EXISTS "Anyone can view active promo codes" ON public.promo_codes;
CREATE POLICY "Anyone can view active promo codes"
ON public.promo_codes
FOR SELECT
USING (is_active = true);

DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviews viewable by everyone" ON public.reviews;
CREATE POLICY "Authenticated users can view reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (true);


-- Source: 20260406232031_d674a1d9-75fa-430b-b9cd-0a5d3c4535bf.sql

DROP POLICY IF EXISTS "Drivers can update assigned orders" ON public.orders;
DROP POLICY IF EXISTS "Store owners can update store orders" ON public.orders;

CREATE POLICY "Drivers can update assigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id)
WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Store owners can update store orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.protect_order_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.tip_amount IS DISTINCT FROM OLD.tip_amount THEN
    RAISE EXCEPTION 'Cannot modify financial fields';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'Cannot modify order ownership fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_order_financials_trigger ON public.orders;
CREATE TRIGGER protect_order_financials_trigger
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.protect_order_financials();


-- Source: 20260407001728_ce728a76-89c3-4356-998b-4dd73f2de8d4.sql
DO $$ BEGIN
CREATE POLICY "Admins can view all driver locations"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Source: 20260408000554_f4670c87-edfc-43e3-95a3-0c345267e964.sql

CREATE TABLE IF NOT EXISTS public.driver_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL UNIQUE,
  available_balance NUMERIC NOT NULL DEFAULT 0,
  pending_balance NUMERIC NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_wallets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers can view own wallet" ON public.driver_wallets FOR SELECT USING (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can view all wallets" ON public.driver_wallets FOR SELECT USING (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage all wallets" ON public.driver_wallets FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS update_driver_wallets_updated_at ON public.driver_wallets;
CREATE TRIGGER update_driver_wallets_updated_at BEFORE UPDATE ON public.driver_wallets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  description TEXT,
  order_id UUID REFERENCES public.orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers can view own transactions" ON public.wallet_transactions FOR SELECT USING (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can view all transactions" ON public.wallet_transactions FOR SELECT USING (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage transactions" ON public.wallet_transactions FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.wait_time_bonuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  order_id UUID REFERENCES public.orders(id),
  arrived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_up_at TIMESTAMPTZ,
  wait_minutes NUMERIC DEFAULT 0,
  bonus_amount NUMERIC DEFAULT 0,
  is_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wait_time_bonuses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers can view own wait bonuses" ON public.wait_time_bonuses FOR SELECT USING (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Drivers can insert own wait bonuses" ON public.wait_time_bonuses FOR INSERT WITH CHECK (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Drivers can update own wait bonuses" ON public.wait_time_bonuses FOR UPDATE USING (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage wait bonuses" ON public.wait_time_bonuses FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  order_id UUID REFERENCES public.orders(id),
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by UUID,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers can view own tickets" ON public.support_tickets FOR SELECT USING (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Drivers can create tickets" ON public.support_tickets FOR INSERT WITH CHECK (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Drivers can update own tickets" ON public.support_tickets FOR UPDATE USING (auth.uid() = driver_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage all tickets" ON public.support_tickets FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS update_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.demand_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km NUMERIC NOT NULL DEFAULT 1.0,
  order_count INTEGER NOT NULL DEFAULT 0,
  driver_count INTEGER NOT NULL DEFAULT 0,
  bonus_amount NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.demand_zones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers can view active demand zones" ON public.demand_zones FOR SELECT TO authenticated USING (is_active = true AND public.has_role(auth.uid(), 'driver')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage demand zones" ON public.demand_zones FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.driver_referrals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL,
  referred_id UUID,
  referral_code TEXT NOT NULL UNIQUE,
  bonus_amount NUMERIC NOT NULL DEFAULT 10.00,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_referrals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers can view own referrals" ON public.driver_referrals FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Drivers can create referrals" ON public.driver_referrals FOR INSERT WITH CHECK (auth.uid() = referrer_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage referrals" ON public.driver_referrals FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.create_driver_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.driver_wallets (driver_id)
  VALUES (NEW.user_id)
  ON CONFLICT (driver_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_wallet_on_driver_profile ON public.driver_profiles;
CREATE TRIGGER create_wallet_on_driver_profile
AFTER INSERT ON public.driver_profiles
FOR EACH ROW EXECUTE FUNCTION public.create_driver_wallet();

CREATE OR REPLACE FUNCTION public.credit_wallet_on_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.driver_wallets (driver_id) VALUES (NEW.driver_id)
  ON CONFLICT (driver_id) DO NOTHING;
  UPDATE public.driver_wallets
  SET available_balance = available_balance + COALESCE(NEW.total, 0)
  WHERE driver_id = NEW.driver_id;
  INSERT INTO public.wallet_transactions (driver_id, type, amount, description, order_id)
  VALUES (NEW.driver_id, 'earning_credit', COALESCE(NEW.total, 0), 'Delivery earning', NEW.order_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_wallet_after_earning ON public.earnings;
CREATE TRIGGER credit_wallet_after_earning
AFTER INSERT ON public.earnings
FOR EACH ROW EXECUTE FUNCTION public.credit_wallet_on_earning();

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_driver_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT available_balance INTO v_balance FROM driver_wallets WHERE driver_id = p_driver_id;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  UPDATE driver_wallets
  SET available_balance = available_balance - p_amount,
      pending_balance = pending_balance + p_amount
  WHERE driver_id = p_driver_id;
  INSERT INTO wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id, 'withdrawal_request', p_amount, 'pending', 'Cash out request');
END;
$$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_wallets; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Source: 20260413065125_b06368f7-e759-4d26-ad33-41de1d9e15bd.sql

ALTER TABLE public.driver_profiles
ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'default';

CREATE OR REPLACE FUNCTION public.protect_driver_layout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.layout IS DISTINCT FROM NEW.layout THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change driver layout';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_driver_layout_trigger ON public.driver_profiles;
CREATE TRIGGER protect_driver_layout_trigger
BEFORE UPDATE ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_driver_layout();


-- Source: 20260417015321_90ede8cc-5b96-4dd3-aab6-0344d77825bd.sql

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS home_address TEXT,
  ADD COLUMN IF NOT EXISTS secondary_phone TEXT;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS base_pay NUMERIC NOT NULL DEFAULT 3.00,
  ADD COLUMN IF NOT EXISTS per_km_rate NUMERIC NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS min_pay NUMERIC NOT NULL DEFAULT 3.00;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Users can upload own avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Users can delete own avatar" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Source: 20260417020311_8d672454-9def-4427-9001-0226b73dc0e2.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'support';

-- Source: 20260417020326_93edc02b-37d3-42f1-86c9-b3ab9f1a1580.sql
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Drivers view own ticket messages" ON public.ticket_messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_messages.ticket_id AND t.driver_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Drivers post on own tickets" ON public.ticket_messages FOR INSERT WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_messages.ticket_id AND t.driver_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support and admins view all messages" ON public.ticket_messages FOR SELECT USING (public.has_role(auth.uid(), 'support'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support and admins post messages" ON public.ticket_messages FOR INSERT WITH CHECK (sender_id = auth.uid() AND (public.has_role(auth.uid(), 'support'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support can view all tickets" ON public.support_tickets FOR SELECT USING (public.has_role(auth.uid(), 'support'::public.app_role)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support can update all tickets" ON public.support_tickets FOR UPDATE USING (public.has_role(auth.uid(), 'support'::public.app_role)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.ticket_messages REPLICA IDENTITY FULL;

-- Source: 20260418001007_4ab75c86-60ed-42ea-84b5-1dfeaff3811e.sql

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS customer_base_fee numeric NOT NULL DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS customer_per_km_fee numeric NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS peak_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS peak_start_hour integer NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS peak_end_hour integer NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS peak_weekdays integer[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  ADD COLUMN IF NOT EXISTS bike_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS motorcycle_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS car_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS default_commission_pct numeric NOT NULL DEFAULT 15.0;

CREATE TABLE IF NOT EXISTS public.store_pricing_overrides (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  base_pay numeric,
  per_km_rate numeric,
  min_pay numeric,
  commission_pct numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_pricing_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can view overrides" ON public.store_pricing_overrides;
CREATE POLICY "Anyone authenticated can view overrides"
  ON public.store_pricing_overrides FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage store overrides" ON public.store_pricing_overrides;
CREATE POLICY "Admins can manage store overrides"
  ON public.store_pricing_overrides FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_driver_id uuid, p_amount numeric, p_description text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can adjust wallets';
  END IF;
  INSERT INTO public.driver_wallets (driver_id) VALUES (p_driver_id)
  ON CONFLICT (driver_id) DO NOTHING;
  UPDATE public.driver_wallets
  SET available_balance = available_balance + p_amount
  WHERE driver_id = p_driver_id;
  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id,
    CASE WHEN p_amount >= 0 THEN 'admin_credit' ELSE 'admin_debit' END,
    p_amount, 'completed', COALESCE(p_description, 'Admin adjustment'));
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_create_earning_on_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric; v_tip numeric; v_total_base numeric;
  v_vehicle_type text;
  v_vehicle_mult numeric := 1.0;
  v_peak_mult numeric := 1.0;
  v_dow integer; v_hour integer;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM earnings WHERE order_id = NEW.id AND driver_id = NEW.driver_id) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = NEW.store_id;
  v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
  v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
  v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
  v_km     := COALESCE(NEW.distance_km, 0);
  v_tip    := COALESCE(NEW.tip_amount, 0);
  SELECT vehicle_type INTO v_vehicle_type FROM driver_profiles WHERE user_id = NEW.driver_id;
  IF v_vehicle_type = 'bike' THEN
    v_vehicle_mult := COALESCE(v_settings.bike_multiplier, 1.0);
  ELSIF v_vehicle_type = 'car' THEN
    v_vehicle_mult := COALESCE(v_settings.car_multiplier, 1.0);
  ELSE
    v_vehicle_mult := COALESCE(v_settings.motorcycle_multiplier, 1.0);
  END IF;
  v_dow  := EXTRACT(ISODOW FROM now())::int;
  v_hour := EXTRACT(HOUR   FROM now())::int;
  IF v_dow = ANY(COALESCE(v_settings.peak_weekdays, ARRAY[1,2,3,4,5,6,7]))
     AND v_hour >= COALESCE(v_settings.peak_start_hour, 19)
     AND v_hour <  COALESCE(v_settings.peak_end_hour, 22) THEN
    v_peak_mult := COALESCE(v_settings.peak_multiplier, 1.0);
  END IF;
  v_total_base := GREATEST(v_min, v_base + v_per_km * v_km) * v_vehicle_mult * v_peak_mult;
  INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus)
  VALUES (NEW.driver_id, NEW.id, v_total_base, v_tip, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_earning_on_delivery ON public.orders;
CREATE TRIGGER trg_auto_earning_on_delivery
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.auto_create_earning_on_delivery();

DROP TRIGGER IF EXISTS trg_credit_wallet_on_earning ON public.earnings;
CREATE TRIGGER trg_credit_wallet_on_earning
AFTER INSERT ON public.earnings
FOR EACH ROW EXECUTE FUNCTION public.credit_wallet_on_earning();

DO $$
DECLARE r record;
DECLARE s platform_settings%ROWTYPE;
DECLARE ov store_pricing_overrides%ROWTYPE;
DECLARE base_p numeric; per_km numeric; min_p numeric;
DECLARE km numeric; tip numeric; total_base numeric;
BEGIN
  SELECT * INTO s FROM platform_settings WHERE id = 1;
  FOR r IN
    SELECT o.id, o.driver_id, o.store_id, o.distance_km, o.tip_amount
    FROM orders o
    WHERE o.status = 'delivered'
      AND o.driver_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM earnings e WHERE e.order_id = o.id)
  LOOP
    SELECT * INTO ov FROM store_pricing_overrides WHERE store_id = r.store_id;
    base_p := COALESCE(ov.base_pay,    s.base_pay,    3);
    per_km := COALESCE(ov.per_km_rate, s.per_km_rate, 0.5);
    min_p  := COALESCE(ov.min_pay,     s.min_pay,     3);
    km  := COALESCE(r.distance_km, 0);
    tip := COALESCE(r.tip_amount, 0);
    total_base := GREATEST(min_p, base_p + per_km * km);
    INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus)
    VALUES (r.driver_id, r.id, total_base, tip, 0);
  END LOOP;
END $$;


-- Source: 20260419000843_2eade468-9133-4b8f-baaa-784b49aed2e4.sql
ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS show_stores_on_driver_map boolean NOT NULL DEFAULT true;

-- Source: 20260420174636_c907f3a5-1a3b-4063-9fd6-e3c61dc1fd70.sql

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_driver_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_driver_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT available_balance INTO v_balance FROM driver_wallets WHERE driver_id = p_driver_id;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  UPDATE driver_wallets
  SET available_balance = available_balance - p_amount,
      pending_balance = pending_balance + p_amount
  WHERE driver_id = p_driver_id;
  INSERT INTO wallet_transactions (driver_id, type, amount, status, description)
  VALUES (p_driver_id, 'withdrawal_request', p_amount, 'pending', 'Cash out request');
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change profile role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;
CREATE TRIGGER protect_profile_role_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

DROP POLICY IF EXISTS "Drivers can view their announcements" ON public.announcements;
DROP POLICY IF EXISTS "Store owners can view their announcements" ON public.announcements;

CREATE POLICY "Drivers can view their announcements"
ON public.announcements
FOR SELECT
USING (
  target_audience = ANY (ARRAY['drivers'::text, 'all'::text])
  AND public.has_role(auth.uid(), 'driver')
);

CREATE POLICY "Store owners can view their announcements"
ON public.announcements
FOR SELECT
USING (
  target_audience = ANY (ARRAY['store_owners'::text, 'all'::text])
  AND public.has_role(auth.uid(), 'store')
);

DROP POLICY IF EXISTS "Stores are viewable by everyone" ON public.stores;
DROP POLICY IF EXISTS "Authenticated users can view stores" ON public.stores;

CREATE POLICY "Authenticated users can view stores"
ON public.stores
FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE VIEW public.stores_public
WITH (security_invoker = true) AS
SELECT id, name, address, latitude, longitude, phone, image_url,
       is_active, busy_mode, prep_buffer_minutes, created_at, updated_at, owner_id
FROM public.stores
WHERE is_active = true AND suspended_at IS NULL;

GRANT SELECT ON public.stores_public TO anon, authenticated;

DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Customers can view own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Store owners can view reviews of their stores" ON public.reviews;

CREATE POLICY "Customers can view own reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (auth.uid() = customer_id);

CREATE POLICY "Store owners can view reviews of their stores"
ON public.reviews
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.stores s
  WHERE s.id = reviews.store_id AND s.owner_id = auth.uid()
));

CREATE OR REPLACE VIEW public.reviews_public
WITH (security_invoker = false) AS
SELECT id, store_id, rating, comment, created_at
FROM public.reviews;

GRANT SELECT ON public.reviews_public TO anon, authenticated;

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own avatar files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

CREATE POLICY "Users can read their own avatar files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);


-- Source: 20260420174649_48552368-2b63-4415-a946-c55aaec03002.sql
DROP VIEW IF EXISTS public.reviews_public;

CREATE VIEW public.reviews_public
WITH (security_invoker = true) AS
SELECT id, store_id, rating, comment, created_at
FROM public.reviews;

GRANT SELECT ON public.reviews_public TO anon, authenticated;

DROP POLICY IF EXISTS "Public can view review ratings" ON public.reviews;
CREATE POLICY "Public can view review ratings"
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (true);


-- Source: 20260420174659_5c00e584-5c51-4034-b3dd-6718a96b6d6c.sql
DROP POLICY IF EXISTS "Public can view review ratings" ON public.reviews;

DROP VIEW IF EXISTS public.reviews_public;

CREATE OR REPLACE FUNCTION public.get_public_reviews(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  store_id uuid,
  rating integer,
  comment text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, store_id, rating, comment, created_at
  FROM public.reviews
  WHERE p_store_id IS NULL OR store_id = p_store_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_reviews(uuid) TO anon, authenticated;


-- Source: 20260420215747_365cfa53-1340-4ca6-b425-14d2bdce6c47.sql
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS sla_warn_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS sla_urgent_seconds integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS sla_breach_seconds integer NOT NULL DEFAULT 600;

DO $$ BEGIN
CREATE POLICY "Support can update SLA settings"
ON public.platform_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'support'))
WITH CHECK (public.has_role(auth.uid(), 'support'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Source: 20260420220513_d03cb165-bca3-4e51-b80a-2d216f89c93e.sql
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

CREATE OR REPLACE FUNCTION public.validate_ticket_priority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.priority NOT IN ('low','normal','high','sos') THEN
    RAISE EXCEPTION 'Invalid priority: %', NEW.priority;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_ticket_priority ON public.support_tickets;
CREATE TRIGGER trg_validate_ticket_priority
BEFORE INSERT OR UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.validate_ticket_priority();

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS sla_agent_scaling boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sla_tickets_per_agent integer NOT NULL DEFAULT 5;

CREATE OR REPLACE FUNCTION public.count_active_support_agents()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.user_roles WHERE role = 'support';
$$;

GRANT EXECUTE ON FUNCTION public.count_active_support_agents() TO authenticated;

-- Source: 20260420221031_94bf291b-3c6b-4c40-970e-851aa7d60e54.sql
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS distribution_mode text NOT NULL DEFAULT 'nearest',
  ADD COLUMN IF NOT EXISTS dist_search_radius_km numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dist_offer_timeout_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS dist_wave_size integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dist_max_waves integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dist_vehicle_rules_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dist_bike_max_km numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dist_motorcycle_max_km numeric NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS dist_car_min_value numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS dist_min_driver_rating numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_min_acceptance_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_fairness_weight numeric NOT NULL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS dist_rating_weight numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS dist_distance_weight numeric NOT NULL DEFAULT 0.3;

CREATE OR REPLACE FUNCTION public.validate_distribution_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.distribution_mode NOT IN ('nearest','broadcast','batched','smart') THEN
    RAISE EXCEPTION 'Invalid distribution_mode: %', NEW.distribution_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_distribution_mode ON public.platform_settings;
CREATE TRIGGER trg_validate_distribution_mode
BEFORE INSERT OR UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_distribution_mode();

-- Source: 20260421210617_d5a63abc-9c36-4b74-905e-987e20f4b8e6.sql
CREATE TABLE IF NOT EXISTS public.support_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'channel',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_channels ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.support_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, user_id)
);

ALTER TABLE public.support_channel_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_team_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.support_channels(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL DEFAULT 'support',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_team_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_team_messages_channel_created ON public.support_team_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON public.support_channel_members(user_id);

CREATE OR REPLACE FUNCTION public.is_support_or_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'support'::app_role) OR public.has_role(_user_id, 'admin'::app_role);
$$;

DO $$ BEGIN CREATE POLICY "Support team can view channels" ON public.support_channels FOR SELECT USING (public.is_support_or_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support team can create channels" ON public.support_channels FOR INSERT WITH CHECK (public.is_support_or_admin(auth.uid()) AND created_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can update channels" ON public.support_channels FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::app_role)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can delete channels" ON public.support_channels FOR DELETE USING (public.has_role(auth.uid(), 'admin'::app_role)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support team can view members" ON public.support_channel_members FOR SELECT USING (public.is_support_or_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support team can join channels" ON public.support_channel_members FOR INSERT WITH CHECK (public.is_support_or_admin(auth.uid()) AND user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Members can update own membership" ON public.support_channel_members FOR UPDATE USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Members can leave" ON public.support_channel_members FOR DELETE USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support team can read messages" ON public.support_team_messages FOR SELECT USING (public.is_support_or_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Support team can post messages" ON public.support_team_messages FOR INSERT WITH CHECK (public.is_support_or_admin(auth.uid()) AND sender_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.support_channels (name, description, type) VALUES
  ('general', 'Γενική συζήτηση ομάδας υποστήριξης', 'channel'),
  ('escalations', 'Κλιμακούμενα tickets και επείγοντα θέματα', 'channel'),
  ('announcements', 'Ανακοινώσεις διαχείρισης', 'channel')
ON CONFLICT DO NOTHING;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_team_messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_channels; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_channel_members; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.support_team_messages REPLICA IDENTITY FULL;
ALTER TABLE public.support_channels REPLICA IDENTITY FULL;
ALTER TABLE public.support_channel_members REPLICA IDENTITY FULL;
