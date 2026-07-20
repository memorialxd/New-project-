import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Banknote, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminInvalidate } from '@/hooks/useAdminInvalidate';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Pending Driver Payouts — orders that couldn't pay the driver
 * because the Driver Buffer was too low. Admin releases them
 * either from the pool (after top-up) or from the admin bag.
 */
export default function PendingPayoutsPanel() {
  const qc = useQueryClient();
  const inv = useAdminInvalidate();

  const list = useQuery({
    queryKey: ['admin-pending-payouts'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pending_driver_payouts')
        .select('id, driver_id, order_id, amount, reason, resolved, created_at')
        .eq('resolved', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Array<{
        id: string; driver_id: string; order_id: string;
        amount: number; reason: string; resolved: boolean; created_at: string;
      }>;
    },
  });

  const release = async (id: string, source: 'pool' | 'admin') => {
    const { data, error } = await (supabase as any).rpc('admin_release_pending_payout', {
      p_pending_id: id,
      p_source: source,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Πληρώθηκε €${Number(data?.amount ?? 0).toFixed(2)} (${source === 'pool' ? 'Buffer' : 'Admin'})`);
    qc.invalidateQueries({ queryKey: ['admin-pending-payouts'] });
    inv.finances();
  };

  const items = list.data ?? [];
  const total = items.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Εκκρεμείς πληρωμές οδηγών
          </span>
          <Badge variant="outline" className="tabular-nums">€{total.toFixed(2)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <CheckCircle2 className="h-4 w-4 text-success" /> Καμία εκκρεμότητα
          </div>
        ) : items.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-muted/30 p-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">Order {p.order_id.slice(0, 8)}…</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(p.created_at).toLocaleString('el-GR')} · {p.reason}
              </p>
            </div>
            <p className="font-bold tabular-nums text-base">€{Number(p.amount).toFixed(2)}</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="default" className="h-8 gap-1" onClick={() => release(p.id, 'pool')}>
                <Banknote className="h-3.5 w-3.5" /> Buffer
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => release(p.id, 'admin')}>
                <ShieldCheck className="h-3.5 w-3.5" /> Admin
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
