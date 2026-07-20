import { useState, useEffect, useCallback } from 'react';
import { Timer, Coins } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const BONUS_PER_MINUTE = 0.10;
const BONUS_THRESHOLD_MINUTES = 10;

interface WaitTimeBonusBannerProps {
  orderId: string;
  status: string;
}

export function WaitTimeBonusBanner({ orderId, status }: WaitTimeBonusBannerProps) {
  const { user } = useAuth();
  const [arrivedAt, setArrivedAt] = useState<Date | null>(null);
  const [waitMinutes, setWaitMinutes] = useState(0);
  const [bonusRecordId, setBonusRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || status !== 'arrived') return;
    const checkOrCreate = async () => {
      const { data } = await supabase
        .from('wait_time_bonuses')
        .select('id, arrived_at')
        .eq('driver_id', user.id)
        .eq('order_id', orderId)
        .maybeSingle();

      if (data) {
        setArrivedAt(new Date(data.arrived_at));
        setBonusRecordId(data.id);
      } else {
        const { data: newRecord } = await supabase
          .from('wait_time_bonuses')
          .insert({ driver_id: user.id, order_id: orderId })
          .select('id, arrived_at')
          .single();
        if (newRecord) {
          setArrivedAt(new Date(newRecord.arrived_at));
          setBonusRecordId(newRecord.id);
        }
      }
    };
    checkOrCreate();
  }, [user, orderId, status]);

  useEffect(() => {
    if (!arrivedAt || status !== 'arrived') return;
    const interval = setInterval(() => {
      const mins = (Date.now() - arrivedAt.getTime()) / 60000;
      setWaitMinutes(Math.floor(mins));
    }, 1000);
    return () => clearInterval(interval);
  }, [arrivedAt, status]);

  useEffect(() => {
    if (status !== 'picked_up' || !bonusRecordId || !user) return;
    const updateBonus = async () => {
      const bonusMins = Math.max(0, waitMinutes - BONUS_THRESHOLD_MINUTES);
      const bonusAmount = bonusMins * BONUS_PER_MINUTE;
      await supabase.from('wait_time_bonuses').update({
        picked_up_at: new Date().toISOString(),
        wait_minutes: waitMinutes,
        bonus_amount: bonusAmount,
        is_applied: bonusAmount > 0,
      }).eq('id', bonusRecordId);
    };
    updateBonus();
  }, [status, bonusRecordId, waitMinutes, user]);

  if (status !== 'arrived' || !arrivedAt) return null;

  const bonusMinutes = Math.max(0, waitMinutes - BONUS_THRESHOLD_MINUTES);
  const bonusAmount = bonusMinutes * BONUS_PER_MINUTE;
  const isEarning = waitMinutes >= BONUS_THRESHOLD_MINUTES;

  return (
    <div className={`rounded-xl p-3 flex items-center gap-3 driver-glass ${
      isEarning ? 'border-2 border-orange-500/30' : ''
    }`}>
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
        isEarning ? 'bg-orange-500/15' : 'bg-[hsl(var(--driver-surface-elevated))]'
      }`}>
        <Timer className={`h-5 w-5 ${isEarning ? 'text-orange-400 animate-pulse' : 'text-[hsl(var(--driver-text-muted))]'}`} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-heading font-medium text-[hsl(var(--driver-text))]">
          Αναμονή: {waitMinutes} λεπτά
        </p>
        {isEarning ? (
          <p className="text-xs text-orange-400 font-medium flex items-center gap-1">
            <Coins className="h-3 w-3" />
            Μπόνους: +{bonusAmount.toFixed(2)}€ (+€0.10/λεπ)
          </p>
        ) : (
          <p className="text-xs text-[hsl(var(--driver-text-muted))]">
            Μπόνους μετά τα {BONUS_THRESHOLD_MINUTES} λεπτά
          </p>
        )}
      </div>
    </div>
  );
}
