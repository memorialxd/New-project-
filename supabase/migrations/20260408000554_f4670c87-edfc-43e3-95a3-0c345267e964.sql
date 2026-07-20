
-- 1. Driver Wallets
CREATE TABLE public.driver_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL UNIQUE,
  available_balance NUMERIC NOT NULL DEFAULT 0,
  pending_balance NUMERIC NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own wallet" ON public.driver_wallets FOR SELECT USING (auth.uid() = driver_id);
CREATE POLICY "Admins can view all wallets" ON public.driver_wallets FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage all wallets" ON public.driver_wallets FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_driver_wallets_updated_at BEFORE UPDATE ON public.driver_wallets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Wallet Transactions
CREATE TABLE public.wallet_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  type TEXT NOT NULL, -- 'earning_credit', 'withdrawal_request', 'withdrawal_completed'
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed', -- 'pending', 'completed', 'failed'
  description TEXT,
  order_id UUID REFERENCES public.orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own transactions" ON public.wallet_transactions FOR SELECT USING (auth.uid() = driver_id);
CREATE POLICY "Admins can view all transactions" ON public.wallet_transactions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage transactions" ON public.wallet_transactions FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Wait Time Bonuses
CREATE TABLE public.wait_time_bonuses (
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

CREATE POLICY "Drivers can view own wait bonuses" ON public.wait_time_bonuses FOR SELECT USING (auth.uid() = driver_id);
CREATE POLICY "Drivers can insert own wait bonuses" ON public.wait_time_bonuses FOR INSERT WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Drivers can update own wait bonuses" ON public.wait_time_bonuses FOR UPDATE USING (auth.uid() = driver_id);
CREATE POLICY "Admins can manage wait bonuses" ON public.wait_time_bonuses FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Support Tickets
CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  category TEXT NOT NULL, -- 'emergency', 'customer_issue', 'vehicle_issue', 'app_issue', 'other'
  description TEXT,
  photo_url TEXT,
  order_id UUID REFERENCES public.orders(id),
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
  resolved_by UUID,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own tickets" ON public.support_tickets FOR SELECT USING (auth.uid() = driver_id);
CREATE POLICY "Drivers can create tickets" ON public.support_tickets FOR INSERT WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Drivers can update own tickets" ON public.support_tickets FOR UPDATE USING (auth.uid() = driver_id);
CREATE POLICY "Admins can manage all tickets" ON public.support_tickets FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Demand Zones
CREATE TABLE public.demand_zones (
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

CREATE POLICY "Drivers can view active demand zones" ON public.demand_zones FOR SELECT TO authenticated USING (is_active = true AND public.has_role(auth.uid(), 'driver'));
CREATE POLICY "Admins can manage demand zones" ON public.demand_zones FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Driver Referrals
CREATE TABLE public.driver_referrals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL,
  referred_id UUID,
  referral_code TEXT NOT NULL UNIQUE,
  bonus_amount NUMERIC NOT NULL DEFAULT 10.00,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'expired'
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own referrals" ON public.driver_referrals FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Drivers can create referrals" ON public.driver_referrals FOR INSERT WITH CHECK (auth.uid() = referrer_id);
CREATE POLICY "Admins can manage referrals" ON public.driver_referrals FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Function to create wallet on driver profile creation
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

CREATE TRIGGER create_wallet_on_driver_profile
AFTER INSERT ON public.driver_profiles
FOR EACH ROW EXECUTE FUNCTION public.create_driver_wallet();

-- 8. Function to credit wallet on earning creation
CREATE OR REPLACE FUNCTION public.credit_wallet_on_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Create wallet if not exists
  INSERT INTO public.driver_wallets (driver_id) VALUES (NEW.driver_id)
  ON CONFLICT (driver_id) DO NOTHING;
  
  -- Credit available balance
  UPDATE public.driver_wallets
  SET available_balance = available_balance + COALESCE(NEW.total, 0)
  WHERE driver_id = NEW.driver_id;
  
  -- Log transaction
  INSERT INTO public.wallet_transactions (driver_id, type, amount, description, order_id)
  VALUES (NEW.driver_id, 'earning_credit', COALESCE(NEW.total, 0), 'Delivery earning', NEW.order_id);
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_wallet_after_earning
AFTER INSERT ON public.earnings
FOR EACH ROW EXECUTE FUNCTION public.credit_wallet_on_earning();

-- 9. Function for cash out / withdrawal request
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

-- Enable realtime for wallet updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
