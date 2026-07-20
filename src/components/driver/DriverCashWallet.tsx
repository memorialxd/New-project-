import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import CashTracker from './CashTracker';
import { Banknote, Receipt } from 'lucide-react';

interface CashDebt {
  id: string;
  order_id: string;
  cash_collected: number;
  amount_owed: number;
  settled: boolean;
  created_at: string;
}

export default function DriverCashWallet() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: debts = [] } = useQuery({
    queryKey: ['driver-cash-debts', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('driver_cash_debts')
        .select('id, order_id, cash_collected, amount_owed, settled, created_at')
        .eq('driver_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as CashDebt[];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel('driver-cash')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'driver_cash_debts', filter: `driver_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ['driver-cash-debts', user.id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);


  return (
    <div className="space-y-4">
      {/* Cash tracker — shift cash balance */}
      <CashTracker />

      {/* Cash collected list */}
      <div className="rounded-2xl driver-glass p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-[hsl(var(--driver-text-muted))]" />
            <h3 className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">Εισπράξεις μετρητών</h3>
          </div>
          {debts.length > 0 && (
            <span className="text-[10px] font-heading uppercase tracking-wider px-2 py-1 rounded-md bg-[hsl(var(--driver-surface))] text-[hsl(var(--driver-text-muted))]">
              {debts.length}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {debts.length === 0 ? (
            <p className="text-xs text-[hsl(var(--driver-text-muted))] text-center py-6">
              Δεν υπάρχουν εισπράξεις μετρητών.
            </p>
          ) : (
            debts.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[hsl(var(--driver-surface))]">
                <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-amber-500/15">
                  <Banknote className="h-4 w-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-[hsl(var(--driver-text))] truncate">
                    #{d.order_id.slice(0, 8).toUpperCase()}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--driver-text-muted))]">
                    {new Date(d.created_at).toLocaleString('el-GR', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-heading font-bold text-sm tabular-nums text-[hsl(var(--driver-text))]">
                    €{Number(d.cash_collected).toFixed(2)}
                  </span>
                  {d.settled ? (
                    <p className="text-[9px] font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400">παραδόθηκε admin</p>
                  ) : (
                    <p className="text-[9px] font-heading uppercase tracking-wider text-amber-600 dark:text-amber-400">κρατάς €{Number(d.amount_owed).toFixed(2)}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
