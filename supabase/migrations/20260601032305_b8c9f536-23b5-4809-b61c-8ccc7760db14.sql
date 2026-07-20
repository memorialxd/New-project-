
-- ============ BUFFER PROGRAMS: Quests, Guarantees, Streaks, Budgets ============

-- 1) Driver Quests (challenges)
CREATE TABLE public.driver_quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  target_type text NOT NULL DEFAULT 'deliveries', -- 'deliveries' | 'earnings' | 'acceptance_streak'
  target_value numeric NOT NULL DEFAULT 10,
  reward_amount numeric NOT NULL DEFAULT 20,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  -- Eligibility
  min_rating numeric DEFAULT NULL,
  min_tenure_days integer DEFAULT NULL,
  vehicle_types text[] DEFAULT NULL,
  zone_id uuid DEFAULT NULL,
  -- Budget
  budget_cap numeric DEFAULT NULL,
  budget_spent numeric NOT NULL DEFAULT 0,
  -- Meta
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_quests TO authenticated;
GRANT ALL ON public.driver_quests TO service_role;
ALTER TABLE public.driver_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage quests" ON public.driver_quests FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view active quests" ON public.driver_quests FOR SELECT
  USING (is_active = true AND has_role(auth.uid(),'driver'));

-- 2) Per-driver progress
CREATE TABLE public.driver_quest_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id uuid NOT NULL REFERENCES public.driver_quests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  current_value numeric NOT NULL DEFAULT 0,
  claimed boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quest_id, driver_id)
);
GRANT SELECT, INSERT, UPDATE ON public.driver_quest_progress TO authenticated;
GRANT ALL ON public.driver_quest_progress TO service_role;
ALTER TABLE public.driver_quest_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage progress" ON public.driver_quest_progress FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view own progress" ON public.driver_quest_progress FOR SELECT
  USING (auth.uid() = driver_id);

-- 3) Guaranteed earnings windows
CREATE TABLE public.driver_guarantees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  min_per_hour numeric NOT NULL DEFAULT 8,
  day_of_week smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,0}'::smallint[], -- 0=Sun
  start_time time NOT NULL DEFAULT '19:00',
  end_time time NOT NULL DEFAULT '23:00',
  zone_id uuid,
  min_acceptance_pct numeric DEFAULT 80,
  is_active boolean NOT NULL DEFAULT true,
  budget_cap numeric,
  budget_spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_guarantees TO authenticated;
GRANT ALL ON public.driver_guarantees TO service_role;
ALTER TABLE public.driver_guarantees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage guarantees" ON public.driver_guarantees FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view active guarantees" ON public.driver_guarantees FOR SELECT
  USING (is_active = true AND has_role(auth.uid(),'driver'));

-- 4) Surge multipliers (extend demand_zones)
ALTER TABLE public.demand_zones
  ADD COLUMN IF NOT EXISTS multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS surge_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS surge_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_surge boolean NOT NULL DEFAULT false;

-- 5) Streak bonuses
CREATE TABLE public.streak_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  consecutive_accepts integer NOT NULL DEFAULT 5,
  reward_amount numeric NOT NULL DEFAULT 5,
  window_hours integer NOT NULL DEFAULT 4,
  is_active boolean NOT NULL DEFAULT true,
  budget_cap numeric,
  budget_spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streak_bonuses TO authenticated;
GRANT ALL ON public.streak_bonuses TO service_role;
ALTER TABLE public.streak_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage streaks" ON public.streak_bonuses FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Drivers view active streaks" ON public.streak_bonuses FOR SELECT
  USING (is_active = true AND has_role(auth.uid(),'driver'));

-- 6) Admin manual buffer adjust (top up / drain / empty)
CREATE OR REPLACE FUNCTION public.admin_adjust_buffer(
  p_amount numeric,
  p_action text, -- 'add' | 'remove' | 'set'
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_delta numeric;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT platform_pool INTO v_before FROM admin_treasury WHERE id = 1 FOR UPDATE;

  IF p_action = 'add' THEN
    v_after := v_before + p_amount;
  ELSIF p_action = 'remove' THEN
    v_after := GREATEST(0, v_before - p_amount);
  ELSIF p_action = 'set' THEN
    v_after := GREATEST(0, p_amount);
  ELSE
    RAISE EXCEPTION 'invalid action';
  END IF;

  v_delta := v_after - v_before;

  UPDATE admin_treasury SET platform_pool = v_after, updated_at = now() WHERE id = 1;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
  VALUES ('manual_adjust', 'platform_pool', v_delta, COALESCE(p_reason, p_action), auth.uid());

  RETURN jsonb_build_object('before', v_before, 'after', v_after, 'delta', v_delta);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_buffer(numeric, text, text) TO authenticated;

-- 7) Claim quest reward (driver-initiated, server-validated)
CREATE OR REPLACE FUNCTION public.claim_quest_reward(p_quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver uuid := auth.uid();
  v_quest driver_quests%ROWTYPE;
  v_progress driver_quest_progress%ROWTYPE;
  v_pool numeric;
BEGIN
  IF v_driver IS NULL OR NOT has_role(v_driver,'driver') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_quest FROM driver_quests WHERE id = p_quest_id FOR UPDATE;
  IF NOT FOUND OR NOT v_quest.is_active THEN
    RAISE EXCEPTION 'quest not available';
  END IF;
  IF v_quest.ends_at IS NOT NULL AND v_quest.ends_at < now() THEN
    RAISE EXCEPTION 'quest ended';
  END IF;
  IF v_quest.budget_cap IS NOT NULL AND v_quest.budget_spent + v_quest.reward_amount > v_quest.budget_cap THEN
    RAISE EXCEPTION 'quest budget exhausted';
  END IF;

  SELECT * INTO v_progress FROM driver_quest_progress
    WHERE quest_id = p_quest_id AND driver_id = v_driver FOR UPDATE;
  IF NOT FOUND OR v_progress.current_value < v_quest.target_value THEN
    RAISE EXCEPTION 'goal not reached';
  END IF;
  IF v_progress.claimed THEN
    RAISE EXCEPTION 'already claimed';
  END IF;

  SELECT platform_pool INTO v_pool FROM admin_treasury WHERE id = 1 FOR UPDATE;
  IF v_pool < v_quest.reward_amount THEN
    RAISE EXCEPTION 'buffer depleted';
  END IF;

  -- Debit pool, credit driver wallet
  UPDATE admin_treasury SET platform_pool = platform_pool - v_quest.reward_amount, updated_at = now() WHERE id = 1;
  UPDATE driver_wallets SET available_balance = available_balance + v_quest.reward_amount, updated_at = now()
    WHERE driver_id = v_driver;

  UPDATE driver_quest_progress SET claimed = true, claimed_at = now(), updated_at = now()
    WHERE id = v_progress.id;
  UPDATE driver_quests SET budget_spent = budget_spent + v_quest.reward_amount, updated_at = now()
    WHERE id = p_quest_id;

  INSERT INTO admin_treasury_ledger(type, bag, amount, description, created_by)
    VALUES ('quest_payout', 'platform_pool', -v_quest.reward_amount,
            'Quest: ' || v_quest.title, v_driver);

  RETURN jsonb_build_object('reward', v_quest.reward_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_quest_reward(uuid) TO authenticated;

-- 8) Auto-increment quest progress on delivered orders
CREATE OR REPLACE FUNCTION public.bump_quest_progress() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  q RECORD;
  v_inc numeric;
BEGIN
  IF NEW.status::text != 'delivered' OR OLD.status::text = 'delivered' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR q IN
    SELECT * FROM driver_quests
    WHERE is_active = true
      AND starts_at <= now()
      AND (ends_at IS NULL OR ends_at > now())
  LOOP
    v_inc := CASE q.target_type
      WHEN 'deliveries' THEN 1
      WHEN 'earnings' THEN COALESCE(NEW.total_amount, 0)
      ELSE 0
    END;
    IF v_inc <= 0 THEN CONTINUE; END IF;

    INSERT INTO driver_quest_progress(quest_id, driver_id, current_value)
    VALUES (q.id, NEW.driver_id, v_inc)
    ON CONFLICT (quest_id, driver_id)
    DO UPDATE SET current_value = driver_quest_progress.current_value + v_inc, updated_at = now()
    WHERE NOT driver_quest_progress.claimed;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_quest_progress ON public.orders;
CREATE TRIGGER trg_bump_quest_progress
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.bump_quest_progress();
