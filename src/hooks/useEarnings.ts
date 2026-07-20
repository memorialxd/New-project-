import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Database } from '@/integrations/supabase/types';

type EarningRow = Database['public']['Tables']['earnings']['Row'];

interface EarningsSummary {
  total: number;
  trips: number;
  basePay: number;
  tips: number;
  bonuses: number;
}

interface DayBreakdown {
  day: string;
  base: number;
  tips: number;
  bonus: number;
}

export function useEarnings() {
  const { user } = useAuth();
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEarnings = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('earnings')
      .select('*')
      .eq('driver_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setEarnings(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchEarnings();
    if (!user) return;
    const ch = supabase
      .channel(`earnings-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'earnings', filter: `driver_id=eq.${user.id}` }, fetchEarnings)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const today = useMemo<EarningsSummary>(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayEarnings = earnings.filter(e => new Date(e.created_at) >= startOfDay);
    return {
      total: todayEarnings.reduce((sum, e) => sum + Number(e.total ?? 0), 0),
      trips: todayEarnings.length,
      basePay: todayEarnings.reduce((sum, e) => sum + Number(e.base_pay), 0),
      tips: todayEarnings.reduce((sum, e) => sum + Number(e.tip ?? 0), 0),
      bonuses: todayEarnings.reduce((sum, e) => sum + Number(e.bonus ?? 0), 0),
    };
  }, [earnings]);

  const week = useMemo<EarningsSummary>(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    const weekEarnings = earnings.filter(e => new Date(e.created_at) >= startOfWeek);
    return {
      total: weekEarnings.reduce((sum, e) => sum + Number(e.total ?? 0), 0),
      trips: weekEarnings.length,
      basePay: weekEarnings.reduce((sum, e) => sum + Number(e.base_pay), 0),
      tips: weekEarnings.reduce((sum, e) => sum + Number(e.tip ?? 0), 0),
      bonuses: weekEarnings.reduce((sum, e) => sum + Number(e.bonus ?? 0), 0),
    };
  }, [earnings]);

  const weekBreakdown = useMemo<DayBreakdown[]>(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const weekEarnings = earnings.filter(e => new Date(e.created_at) >= startOfWeek);

    return days.map((day, i) => {
      const dayEarnings = weekEarnings.filter(e => new Date(e.created_at).getDay() === i);
      return {
        day,
        base: dayEarnings.reduce((sum, e) => sum + Number(e.base_pay), 0),
        tips: dayEarnings.reduce((sum, e) => sum + Number(e.tip ?? 0), 0),
        bonus: dayEarnings.reduce((sum, e) => sum + Number(e.bonus ?? 0), 0),
      };
    });
  }, [earnings]);

  return { today, week, weekBreakdown, loading, refetch: fetchEarnings };
}
