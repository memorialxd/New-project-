import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Rewards {
  points: number;
  tier: string;
  lifetime_points: number;
}

const TIER_THRESHOLDS: Record<string, { next: string | null; nextAt: number | null; label: string }> = {
  bronze: { next: 'silver', nextAt: 200, label: 'Χάλκινο' },
  silver: { next: 'gold', nextAt: 500, label: 'Ασημένιο' },
  gold: { next: 'platinum', nextAt: 1000, label: 'Χρυσό' },
  platinum: { next: null, nextAt: null, label: 'Πλατινένιο' },
};

export function useRewards() {
  const { user } = useAuth();
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setRewards(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('customer_rewards' as any)
      .select('points, tier, lifetime_points')
      .eq('user_id', user.id)
      .maybeSingle();
    setRewards((data as any) ?? { points: 0, tier: 'bronze', lifetime_points: 0 });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetch();
    if (!user) return;
    const ch = supabase
      .channel(`rewards-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_rewards', filter: `user_id=eq.${user.id}` },
        () => fetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, fetch]);

  const tierInfo = rewards ? TIER_THRESHOLDS[rewards.tier] ?? TIER_THRESHOLDS.bronze : TIER_THRESHOLDS.bronze;

  return { rewards, loading, tierInfo, refetch: fetch };
}

export function tierEmoji(tier: string) {
  switch (tier) {
    case 'platinum':
      return '💎';
    case 'gold':
      return '🥇';
    case 'silver':
      return '🥈';
    default:
      return '🥉';
  }
}
