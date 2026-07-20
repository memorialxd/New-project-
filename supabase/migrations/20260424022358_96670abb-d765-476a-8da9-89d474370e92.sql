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