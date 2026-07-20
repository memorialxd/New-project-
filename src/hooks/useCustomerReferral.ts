import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CustomerReferral {
  id: string;
  referrer_id: string;
  referral_code: string;
  status: string;
  reward_amount: number;
  referred_id: string | null;
  created_at: string;
  completed_at: string | null;
}

function generateCode(prefix = 'INVITE') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

export function useCustomerReferral() {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<CustomerReferral[]>([]);
  const [loading, setLoading] = useState(true);

  const ensureCode = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data: existing } = await supabase
      .from('customer_referrals')
      .select('*')
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false });

    let active = (existing ?? []).find(r => r.status === 'pending' && r.referred_id === null);
    if (!active) {
      const newCode = generateCode();
      const { data: created } = await supabase
        .from('customer_referrals')
        .insert({ referrer_id: user.id, referral_code: newCode })
        .select()
        .single();
      if (created) active = created as CustomerReferral;
    }
    setCode(active?.referral_code ?? null);
    setReferrals((existing ?? []) as CustomerReferral[]);
    setLoading(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ensureCode(); }, [ensureCode]);

  return { code, referrals, loading, refresh: ensureCode };
}
