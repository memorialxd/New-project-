import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, TrendingUp, Lock, Banknote, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';

interface Props {
  storeId: string;
}

export default function StoreWalletCard({ storeId }: Props) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const generateStatement = async () => {
    setGenerating(true);
    try {
      const since = subDays(new Date(), 30).toISOString();
      const [{ data: ledger }, { data: store }] = await Promise.all([
        (supabase as any).from('store_wallet_ledger')
          .select('created_at, type, amount, description, order_id')
          .eq('store_id', storeId)
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        (supabase as any).from('stores').select('name').eq('id', storeId).maybeSingle(),
      ]);

      const rows = (ledger ?? []) as Array<any>;
      const earnings = rows.filter(r => r.amount > 0).reduce((s, r) => s + Number(r.amount), 0);
      const charges = rows.filter(r => r.amount < 0 && r.type !== 'payout').reduce((s, r) => s + Number(r.amount), 0);
      const payouts = rows.filter(r => r.type === 'payout').reduce((s, r) => s + Number(r.amount), 0);
      const net = earnings + charges + payouts;

      const header = ['Ημερομηνία', 'Τύπος', 'Περιγραφή', 'Παραγγελία', 'Ποσό (€)'];
      const csv = [
        `Statement: ${store?.name ?? 'Store'}`,
        `Περίοδος: ${format(subDays(new Date(), 30), 'dd/MM/yyyy')} - ${format(new Date(), 'dd/MM/yyyy')}`,
        '',
        `Συνολικά κέρδη,${earnings.toFixed(2)}`,
        `Συνολικές χρεώσεις,${charges.toFixed(2)}`,
        `Πληρωμές προς εσάς,${payouts.toFixed(2)}`,
        `ΚΑΘΑΡΟ ΥΠΟΛΟΙΠΟ,${net.toFixed(2)}`,
        '',
        header.join(','),
        ...rows.map(r => [
          format(new Date(r.created_at), 'dd/MM/yyyy HH:mm'),
          r.type,
          `"${(r.description ?? '').replace(/"/g, '""')}"`,
          r.order_id ?? '',
          Number(r.amount).toFixed(2),
        ].join(','))
      ].join('\n');

      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${(store?.name ?? 'store').replace(/\s+/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Κατάσταση δημιουργήθηκε');
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία δημιουργίας');
    } finally {
      setGenerating(false);
    }
  };

  const { data: wallet } = useQuery({
    queryKey: ['store-wallet', storeId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('store_wallets')
        .select('available_balance, lifetime_earnings, updated_at')
        .eq('store_id', storeId)
        .maybeSingle();
      if (error) throw error;
      return data as { available_balance: number; lifetime_earnings: number; updated_at: string } | null;
    },
    enabled: !!storeId,
  });

  const { data: ledger } = useQuery({
    queryKey: ['store-wallet-ledger', storeId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('store_wallet_ledger')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; type: string; amount: number; description: string; created_at: string }>;
    },
    enabled: !!storeId,
  });

  useEffect(() => {
    if (!storeId) return;
    const ch = supabase
      .channel(`store-wallet-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_wallets', filter: `store_id=eq.${storeId}` },
        () => qc.invalidateQueries({ queryKey: ['store-wallet', storeId] }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_wallet_ledger', filter: `store_id=eq.${storeId}` },
        () => qc.invalidateQueries({ queryKey: ['store-wallet-ledger', storeId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId, qc]);

  const available = Number(wallet?.available_balance ?? 0);
  const lifetime = Number(wallet?.lifetime_earnings ?? 0);

  return (
    <div className="space-y-4">
      {/* Hero: Admin owes you */}
      {available > 0 ? (
        <Card className="border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent shadow-lg">
          <CardContent className="p-6">
            <p className="text-[10px] font-heading uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400 mb-1">
              Ο διαχειριστής σου χρωστάει
            </p>
            <p className="text-5xl font-heading font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
              €{available.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Αυτό είναι το ποσό που θα σου καταβληθεί στην επόμενη πληρωμή.
            </p>
          </CardContent>
        </Card>
      ) : available < 0 ? (
        <Card className="border-2 border-destructive/40 bg-gradient-to-br from-destructive/10 to-transparent shadow-lg">
          <CardContent className="p-6">
            <p className="text-[10px] font-heading uppercase tracking-[0.2em] text-destructive mb-1">
              Οφείλεις στην πλατφόρμα
            </p>
            <p className="text-5xl font-heading font-extrabold tabular-nums text-destructive">
              €{Math.abs(available).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              External παραγγελίες (efood/wolt/box) — θα συμψηφιστεί με μελλοντικά κέρδη.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-border bg-muted/30">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">Δεν υπάρχει εκκρεμές υπόλοιπο.</p>
          </CardContent>
        </Card>
      )}

      <Card className="border-l-4 border-l-emerald-500 shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-heading text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Πορτοφόλι Καταστήματος
            </CardTitle>
            <span className="flex items-center gap-1 text-[9px] font-heading uppercase tracking-wider text-muted-foreground bg-muted px-2 py-1 rounded-md">
              <Lock className="h-2.5 w-2.5" /> Read-only
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className={`text-4xl font-heading font-extrabold tabular-nums ${available >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
            €{available.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {available >= 0 ? 'Διαθέσιμο για πληρωμή (85% από in-app παραγγελίες)' : 'Οφειλή προς την πλατφόρμα (external delivery)'}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <TrendingUp className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Συνολικά κέρδη: <span className="font-medium tabular-nums">€{lifetime.toFixed(2)}</span></span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            <strong>In-app:</strong> κρατάμε 15% (5% admin + 10% λειτουργίας).<br/>
            <strong>External (efood/wolt/box):</strong> χρεώνεστε το delivery fee του οδηγού.
          </p>

          <Button
            onClick={generateStatement}
            disabled={generating}
            variant="outline"
            size="sm"
            className="mt-4 w-full gap-2"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Δημιουργία Κατάστασης (30 ημέρες CSV)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-heading">Πρόσφατες Συναλλαγές</CardTitle></CardHeader>
        <CardContent>
          {ledger && ledger.length > 0 ? (
            <div className="divide-y divide-border">
              {ledger.map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-2.5">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    l.amount >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
                  }`}>
                    <Banknote className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{l.description ?? l.type}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(l.created_at).toLocaleString('el-GR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className={`font-heading font-bold text-sm tabular-nums ${l.amount >= 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {l.amount >= 0 ? '+' : ''}€{Number(l.amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">Δεν υπάρχουν συναλλαγές ακόμα.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
