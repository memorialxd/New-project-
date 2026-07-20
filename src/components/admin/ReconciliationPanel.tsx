import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

type Row = { label: string; wallet_total: number; ledger_total: number };

async function fetchTotals(): Promise<Row[]> {
  const [drv, str, cus, treas, basket] = await Promise.all([
    (supabase as any).from('driver_wallets').select('available_balance, pending_balance'),
    (supabase as any).from('store_wallets').select('available_balance'),
    (supabase as any).from('customer_wallets').select('balance'),
    (supabase as any).from('admin_treasury').select('admin_balance, platform_pool').maybeSingle(),
    (supabase as any).from('basket_health').select('current_balance').maybeSingle(),
  ]);

  const sum = (rows: any[] | null, key: string) =>
    (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);

  const ledgerSum = async (kind: string) => {
    const { data } = await (supabase as any)
      .from('transactions').select('amount').eq('wallet_kind', kind);
    return (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  };

  const [lDrv, lStr, lCus, lAdm, lBkt] = await Promise.all(
    ['driver', 'store', 'customer', 'admin', 'basket'].map(ledgerSum),
  );

  const driverWallet = sum(drv.data, 'available_balance') + sum(drv.data, 'pending_balance');

  return [
    { label: 'Οδηγοί',         wallet_total: driverWallet,                                   ledger_total: lDrv },
    { label: 'Καταστήματα',    wallet_total: sum(str.data, 'available_balance'),             ledger_total: lStr },
    { label: 'Πελάτες',        wallet_total: sum(cus.data, 'balance'),                       ledger_total: lCus },
    { label: 'Admin',          wallet_total: Number(treas.data?.admin_balance ?? 0),         ledger_total: lAdm },
    { label: 'Driver Basket',  wallet_total: Number(basket.data?.current_balance ?? 0),      ledger_total: lBkt },
  ];
}

export default function ReconciliationPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['reconciliation'],
    refetchInterval: 30000,
    queryFn: fetchTotals,
  });

  const round = (n: number) => Math.round(n * 100) / 100;
  const drift = (r: Row) => round(r.wallet_total - r.ledger_total);
  const ok = (r: Row) => Math.abs(drift(r)) <= 0.01;
  const allOk = (data ?? []).every(ok);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {allOk
            ? <CheckCircle2 className="h-4 w-4 text-success" />
            : <AlertTriangle className="h-4 w-4 text-warning" />}
          Αντιπαραβολή ταμείων ↔ καθολικό
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Το άθροισμα κινήσεων του ενιαίου καθολικού πρέπει να ισούται με το τρέχον υπόλοιπο κάθε ταμείου.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="divide-y divide-border">
            {(data ?? []).map(r => {
              const d = drift(r);
              const good = Math.abs(d) <= 0.01;
              return (
                <div key={r.label} className="grid grid-cols-4 gap-3 items-center px-4 py-3 text-sm">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-right font-mono text-xs text-muted-foreground">€{round(r.wallet_total).toFixed(2)}</div>
                  <div className="text-right font-mono text-xs text-muted-foreground">€{round(r.ledger_total).toFixed(2)}</div>
                  <div className="text-right">
                    {good
                      ? <Badge className="bg-success/15 text-success border-success/30">OK</Badge>
                      : <Badge className="bg-warning/15 text-warning border-warning/30">Δ €{d.toFixed(2)}</Badge>}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-4 gap-3 px-4 py-2 text-[10.5px] uppercase tracking-wide text-muted-foreground bg-muted/30 order-first">
              <div>Ταμείο</div>
              <div className="text-right">Υπόλοιπο</div>
              <div className="text-right">Καθολικό</div>
              <div className="text-right">Διαφορά</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
