import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, DollarSign, AlertTriangle, Users, Wallet, Banknote, Building2,
  Coins, Loader2, Save, Search, TrendingUp, Activity, X,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { format, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAdminInvalidate } from '@/hooks/useAdminInvalidate';
import { TableSkeleton } from '@/components/admin/TableSkeleton';
import { formatOrderNumber } from '@/lib/order-number';

interface Props {
  orders: any[];
  stores: any[];
  profiles: any[];
  reviews: any[];
  earnings: any[];
}

/* ─────────────────────────  Sparkline (pure SVG)  ───────────────────────── */
function Sparkline({ values, color = 'hsl(var(--primary))' }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const w = 120, h = 32, pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = (w - pad * 2) / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const area = `M${pad},${h} L${pts.split(' ').join(' L')} L${w - pad},${h} Z`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={area} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─────────────────────────  Gauge / Progress card  ─────────────────────── */
function MoneyBag({
  label, value, sub, icon: Icon, tone, percent, tip,
}: {
  label: string; value: string; sub: string; icon: React.ElementType;
  tone: 'emerald' | 'blue' | 'orange' | 'red';
  percent: number; tip: string;
}) {
  const toneMap = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-600 dark:text-blue-400',       bar: 'bg-blue-500' },
    orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-600 dark:text-orange-400',   bar: 'bg-orange-500' },
    red:     { bg: 'bg-red-500/10',     text: 'text-red-600 dark:text-red-400',         bar: 'bg-red-500' },
  }[tone];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="rounded-xl border border-border bg-card p-3 hover:shadow-sm transition-shadow cursor-help">
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
                <p className="text-xl font-bold tabular-nums mt-0.5 truncate">{value}</p>
              </div>
              <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', toneMap.bg)}>
                <Icon className={cn('h-4 w-4', toneMap.text)} />
              </div>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', toneMap.bar)}
                style={{ width: `${Math.min(Math.max(percent, 4), 100)}%` }}
              />
            </div>
            <p className="text-[10.5px] text-muted-foreground mt-1.5 truncate">{sub}</p>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─────────────────────────  Stat card with sparkline  ──────────────────── */
function StatCard({
  label, value, trend, icon: Icon, tone = 'default', sub,
}: {
  label: string; value: string | number; trend: number[];
  icon: React.ElementType; tone?: 'default' | 'danger' | 'info' | 'success'; sub?: string;
}) {
  const toneMap = {
    default: { val: 'text-foreground',    icon: 'text-muted-foreground', spark: 'hsl(var(--primary))' },
    danger:  { val: 'text-red-600 dark:text-red-400',     icon: 'text-red-500',     spark: 'hsl(0 84% 60%)' },
    info:    { val: 'text-blue-600 dark:text-blue-400',   icon: 'text-blue-500',    spark: 'hsl(217 91% 60%)' },
    success: { val: 'text-emerald-600 dark:text-emerald-400', icon: 'text-emerald-500', spark: 'hsl(142 76% 45%)' },
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <Icon className={cn('h-4 w-4', toneMap.icon)} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('text-2xl font-bold tabular-nums leading-tight', toneMap.val)}>{value}</div>
          {sub && <div className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        <Sparkline values={trend} color={toneMap.spark} />
      </div>
    </div>
  );
}

/* ─────────────────────────  Main Overview  ────────────────────────────── */
export default function AdminOverview({ orders, profiles }: Props) {
  const today = new Date();
  const qcTop = useQueryClient();

  /* Realtime: refetch treasury / store-owed / cash whenever the underlying tables change */
  useEffect(() => {
    const ch = supabase
      .channel('admin-overview-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_treasury' },
        () => qcTop.invalidateQueries({ queryKey: ['admin-treasury-overview'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_wallets' },
        () => qcTop.invalidateQueries({ queryKey: ['admin-store-owed'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_state' },
        () => qcTop.invalidateQueries({ queryKey: ['admin-cash-on-street'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qcTop]);

  /* Treasury */
  const { data: treasury } = useQuery({
    queryKey: ['admin-treasury-overview'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('admin_treasury').select('*').eq('id', 1).maybeSingle();
      return data as { admin_balance: number; platform_pool: number; lifetime_admin_earned: number; lifetime_platform_earned: number } | null;
    },
    refetchInterval: 30_000,
  });

  /* Pending store payouts */
  const { data: storeOwed } = useQuery({
    queryKey: ['admin-store-owed'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('store_wallets').select('available_balance');
      return (data ?? []).reduce((s: number, r: any) => s + Number(r.available_balance ?? 0), 0);
    },
    refetchInterval: 30_000,
  });

  /* Cash on street (active drivers only) */
  const { data: cashOnStreet } = useQuery({
    queryKey: ['admin-cash-on-street'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('driver_state').select('shift_cash_balance, shift_started_at');
      return (data ?? []).filter((r: any) => r.shift_started_at).reduce((s: number, r: any) => s + Number(r.shift_cash_balance ?? 0), 0);
    },
    refetchInterval: 30_000,
  });

  /* Active drivers count */
  const activeDrivers = useMemo(() => {
    const driverIds = new Set(orders.filter(o => ['accepted', 'preparing', 'ready', 'picked_up'].includes(o.status) && o.driver_id).map(o => o.driver_id));
    return driverIds.size;
  }, [orders]);

  /* Order status buckets */
  const queueOrders = orders.filter(o => ['pending', 'placed', 'accepted', 'preparing', 'ready'].includes(o.status));
  const delayedOrders = orders.filter(o => {
    if (['delivered', 'cancelled'].includes(o.status)) return false;
    const ageMin = (Date.now() - new Date(o.created_at).getTime()) / 60000;
    return ageMin > 45;
  });

  /* Today's profit (5% of delivered) */
  const todayKey = format(today, 'yyyy-MM-dd');
  const todayDelivered = orders.filter(o => o.status === 'delivered' && o.created_at.slice(0, 10) === todayKey);
  const todayProfit = todayDelivered.reduce((s, o) => s + Number(o.platform_profit ?? 0), 0);

  /* 7-day trend (delivered orders per day) */
  const trend7 = useMemo(() => {
    const days: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      days.push(orders.filter(o => o.created_at.slice(0, 10) === d).length);
    }
    return days;
  }, [orders]);
  const profitTrend = useMemo(() => {
    const arr: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      arr.push(orders.filter(o => o.status === 'delivered' && o.created_at.slice(0, 10) === d)
        .reduce((s, o) => s + Number(o.platform_profit ?? 0), 0));
    }
    return arr;
  }, [orders]);
  const driverTrend = trend7.map(c => Math.max(1, Math.round(c / 3)));
  const delayedTrend = useMemo(() => {
    const arr: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      arr.push(orders.filter(o => o.created_at.slice(0, 10) === d && !['delivered', 'cancelled'].includes(o.status)).length);
    }
    return arr;
  }, [orders]);

  /* Money bag percentages (visual fill, relative to lifetime) */
  const adminBal = Number(treasury?.admin_balance ?? 0);
  const platformBal = Number(treasury?.platform_pool ?? 0);
  const lifetimeAdmin = Number(treasury?.lifetime_admin_earned ?? 1);
  const lifetimePlat = Number(treasury?.lifetime_platform_earned ?? 1);
  const owedBal = Number(storeOwed ?? 0);
  const cashBal = Number(cashOnStreet ?? 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
          <p className="text-[12px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · {format(today, 'EEE, dd MMM yyyy · HH:mm')}
          </p>
        </div>
        
      </div>

      {/* 3-COLUMN GRID */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* ───── Column 2 (Main Ops) — spans 8 ───── */}
        <div className="xl:col-span-8 space-y-4 order-2 xl:order-1">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Ενεργοί Οδηγοί" value={activeDrivers} trend={driverTrend} icon={Users} tone="info" sub="σε αποστολή" />
            <StatCard label="Ουρά Παραγγ." value={queueOrders.length} trend={trend7} icon={ShoppingBag} tone="info" sub="προς διεκπεραίωση" />
            <StatCard label="Καθυστερημένες" value={delayedOrders.length} trend={delayedTrend} icon={AlertTriangle} tone="danger" sub=">45 λεπτά" />
            <StatCard label="Κέρδος Σήμερα" value={`€${todayProfit.toFixed(2)}`} trend={profitTrend} icon={DollarSign} tone="success" sub={`${todayDelivered.length} παραδ.`} />
          </div>

          {/* Recent orders */}
          <RecentOrdersTable orders={orders} profiles={profiles} />
        </div>

        {/* ───── Column 3 (Financial Control) — spans 4 ───── */}
        <div className="xl:col-span-4 space-y-4 order-1 xl:order-2">
          {/* Money Bags */}
          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Money Bags</span>
              </div>
              <Badge variant="outline" className="text-[10px] h-5">Live</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5">
              <MoneyBag
                label="Driver Pool"
                value={`€${platformBal.toFixed(2)}`}
                sub={`Lifetime €${lifetimePlat.toFixed(0)}`}
                icon={Coins} tone="emerald"
                percent={Math.min((platformBal / Math.max(lifetimePlat, 1)) * 100, 100)}
                tip="Πλεόνασμα από επιτυχημένες παραδόσεις. Επιδοτεί εγγυήσεις & μεγάλες αποστάσεις."
              />
              <MoneyBag
                label="Treasury (5%)"
                value={`€${adminBal.toFixed(2)}`}
                sub={`Lifetime €${lifetimeAdmin.toFixed(0)}`}
                icon={Banknote} tone="blue"
                percent={Math.min((adminBal / Math.max(lifetimeAdmin, 1)) * 100, 100)}
                tip="Έσοδα admin από προμήθειες. Αποθηκεύεται για συντήρηση πλατφόρμας & φόρους."
              />
              <MoneyBag
                label="Owed to Stores"
                value={`€${owedBal.toFixed(2)}`}
                sub="Pending payouts"
                icon={Building2} tone="orange"
                percent={owedBal > 0 ? Math.min(Math.log10(owedBal + 1) * 25, 100) : 4}
                tip="Σύνολο από store_wallets που δεν έχει ακόμα εκταμιευθεί στα καταστήματα."
              />
              <MoneyBag
                label="Cash on Street"
                value={`€${cashBal.toFixed(2)}`}
                sub="Held by active drivers"
                icon={Activity} tone="red"
                percent={cashBal > 0 ? Math.min(Math.log10(cashBal + 1) * 25, 100) : 4}
                tip="Φυσικά μετρητά που έχουν συλλέξει οι οδηγοί σε ενεργή βάρδια. Πρέπει να επιστραφούν."
              />
            </div>
          </div>

          {/* Live settings */}
          <FinancialSettingsCard />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Recent Orders Table  ───────────────────────── */
function RecentOrdersTable({ orders, profiles }: { orders: any[]; profiles: any[] }) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' });

  const driverNames = useMemo(() => {
    const m = new Map<string, string>();
    profiles.forEach(p => m.set(p.user_id, p.full_name || p.user_id.slice(0, 6)));
    return m;
  }, [profiles]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase().trim();
    let rows = orders.slice(0, 50);
    if (f) {
      rows = rows.filter(o =>
        o.id.toLowerCase().includes(f) ||
        (o.status ?? '').toLowerCase().includes(f) ||
        (driverNames.get(o.driver_id) ?? '').toLowerCase().includes(f),
      );
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      if (va == null) return 1; if (vb == null) return -1;
      return va > vb ? dir : va < vb ? -dir : 0;
    });
    return rows.slice(0, 12);
  }, [orders, filter, sort, driverNames]);

  const toggleSort = (key: string) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const statusTone = (s: string) => {
    if (['delivered'].includes(s)) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
    if (['cancelled'].includes(s)) return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30';
    if (['picked_up', 'ready'].includes(s)) return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
    return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30';
  };

  const rowDelayed = (o: any) => {
    if (['delivered', 'cancelled'].includes(o.status)) return false;
    return (Date.now() - new Date(o.created_at).getTime()) / 60000 > 45;
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
        <ShoppingBag className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold text-sm">Πρόσφατες Παραγγελίες</span>
        <Badge variant="secondary" className="h-5 text-[10px]">{orders.length}</Badge>
        <div className="ml-auto relative w-full sm:w-56">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Αναζήτηση..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-7 h-8 text-[12px]"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {[
                { k: 'id', l: 'Order ID' },
                { k: 'store_id', l: 'Κατάστημα' },
                { k: 'driver_id', l: 'Οδηγός' },
                { k: 'status', l: 'Κατάσταση' },
                { k: 'total_amount', l: 'Ποσό' },
                { k: 'created_at', l: 'Ώρα' },
              ].map(h => (
                <th key={h.k} className="text-left px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort(h.k)}>
                  {h.l}{sort.key === h.k && <span className="ml-1 text-[10px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
              <th className="text-right px-3 py-2 font-medium">Ενέργειες</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o, i) => {
              const cancellable = !['delivered', 'cancelled'].includes(o.status);
              return (
              <tr key={o.id} className={cn('border-t border-border/50', i % 2 && 'bg-muted/20', rowDelayed(o) && 'bg-red-500/5')}>
                <td className="px-3 py-2 font-mono text-[11.5px] font-bold text-foreground">{formatOrderNumber(o)}</td>
                <td className="px-3 py-2 text-muted-foreground">{o.store_id?.slice(0, 6) ?? '—'}</td>
                <td className="px-3 py-2">{o.driver_id ? driverNames.get(o.driver_id) ?? o.driver_id.slice(0, 6) : <span className="text-muted-foreground italic">—</span>}</td>
                <td className="px-3 py-2">
                  <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border', statusTone(o.status))}>
                    {rowDelayed(o) && <AlertTriangle className="h-2.5 w-2.5" />}
                    {o.status}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums">€{Number(o.total_amount).toFixed(2)}</td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{format(new Date(o.created_at), 'dd MMM, HH:mm')}</td>
                <td className="px-3 py-2 text-right">
                  {cancellable && <CancelOrderButton order={o} />}
                </td>
              </tr>
              );
            })}
            {!filtered.length && (
              <tr><td colSpan={7} className="p-0">
                {orders.length === 0
                  ? <TableSkeleton rows={5} columns={6} />
                  : <div className="text-center text-muted-foreground py-10">Καμία παραγγελία</div>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────  Cancel Order Button  ───────────────────────── */
function CancelOrderButton({ order }: { order: any }) {
  const invalidate = useAdminInvalidate();
  const [busy, setBusy] = useState(false);

  const refundable = Number(order.total_amount ?? 0) - Number(order.refunded_amount ?? 0);
  const isPaidCard = order.payment_method !== 'cash' && order.status !== 'pending';
  const willRefund = isPaidCard && refundable > 0;

  const handleCancel = async () => {
    setBusy(true);
    try {
      // Refund first (so we never leave money owed if status update succeeds
      // but refund fails). Uses the existing SECURITY DEFINER RPC which handles
      // wallet credit + audit log atomically.
      if (willRefund) {
        const { error: refundErr } = await (supabase.rpc as any)('refund_order', {
          p_order_id: order.id,
          p_amount: refundable,
          p_reason: 'Order cancelled by admin',
          p_refund_type: 'wallet_credit',
          p_notes: null,
        });
        if (refundErr) {
          toast.error('Αποτυχία επιστροφής: ' + refundErr.message);
          return;
        }
      }

      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' as any })
        .eq('id', order.id);
      if (error) {
        toast.error('Αποτυχία ακύρωσης: ' + error.message);
        return;
      }

      // Best-effort audit entry (non-blocking; cash orders have no refund row)
      await (supabase.rpc as any)('log_admin_action', {
        p_action: 'cancel_order',
        p_target_type: 'order',
        p_target_id: order.id,
        p_description: willRefund
          ? `Cancelled & refunded €${refundable.toFixed(2)} to wallet`
          : 'Cancelled order',
        p_metadata: { refunded: willRefund, amount: willRefund ? refundable : 0 },
      }).catch(() => {});

      // Notify driver if assigned
      if (order.driver_id) {
        await (supabase.from as any)('driver_notifications').insert({
          driver_id: order.driver_id,
          title: 'Παραγγελία ακυρώθηκε',
          body: `Η παραγγελία #${order.id.slice(0, 8)} ακυρώθηκε από την υποστήριξη.`,
          severity: 'warning',
        }).then(() => undefined).catch(() => undefined);
      }

      toast.success(willRefund
        ? `Ακυρώθηκε και επιστράφηκαν €${refundable.toFixed(2)}`
        : 'Παραγγελία ακυρώθηκε');
      invalidate.orders();
      invalidate.finances();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10" title="Ακύρωση παραγγελίας">
          <X className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ακύρωση #{order.id.slice(0, 8)};</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span>Η παραγγελία θα μαρκαριστεί ως ακυρωμένη.</span>
            {willRefund && (
              <span className="block rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
                💰 Θα επιστραφούν αυτόματα <strong>€{refundable.toFixed(2)}</strong> στο πορτοφόλι του πελάτη.
              </span>
            )}
            {!willRefund && order.payment_method === 'cash' && (
              <span className="block text-xs italic">Πληρωμή σε μετρητά — δεν χρειάζεται επιστροφή.</span>
            )}
            {order.driver_id && (
              <span className="block text-xs">Έχει ανατεθεί σε οδηγό — θα ειδοποιηθεί.</span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Όχι</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={handleCancel}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Ναι, ακύρωση{willRefund && ' & επιστροφή'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─────────────────────────  Financial Settings  ─────────────────────────── */
function FinancialSettingsCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    admin_share_pct: 5.0,
    base_pay: 2.5,
    per_km_rate: 0.8,
    customer_base_fee: 3.5,
  });
  const [loaded, setLoaded] = useState(false);

  const { data } = useQuery({
    queryKey: ['platform-settings-overview'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('platform_settings').select('admin_share_pct, base_pay, per_km_rate, customer_base_fee').eq('id', 1).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (data && !loaded) {
      setForm({
        admin_share_pct: Number(data.admin_share_pct ?? 5),
        base_pay: Number(data.base_pay ?? 2.5),
        per_km_rate: Number(data.per_km_rate ?? 0.8),
        customer_base_fee: Number(data.customer_base_fee ?? 3.5),
      });
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = async () => {
    setBusy(true);
    const { error } = await (supabase as any).from('platform_settings').update(form).eq('id', 1);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Ρυθμίσεις ενημερώθηκαν');
    qc.invalidateQueries({ queryKey: ['platform-settings-overview'] });
  };

  const fields: { key: keyof typeof form; label: string; suffix: string; step: number }[] = [
    { key: 'admin_share_pct',   label: 'Treasury (Admin %)',   suffix: '%',    step: 0.5 },
    { key: 'base_pay',          label: 'Driver Base Fee',      suffix: '€',    step: 0.1 },
    { key: 'per_km_rate',       label: 'Driver per-km Rate',   suffix: '€/km', step: 0.05 },
    { key: 'customer_base_fee', label: 'Global Delivery Fee',  suffix: '€',    step: 0.1 },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Clockwork Settings</span>
        </div>
        <Badge variant="outline" className="text-[10px] h-5">Live constants</Badge>
      </div>
      <div className="space-y-3">
        {fields.map(f => (
          <div key={f.key}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11.5px] font-medium text-muted-foreground">{f.label}</label>
              <span className="text-[11.5px] font-mono tabular-nums">{form[f.key].toFixed(2)} {f.suffix}</span>
            </div>
            <Input
              type="number"
              step={f.step}
              min={0}
              value={form[f.key]}
              onChange={e => setForm(s => ({ ...s, [f.key]: Number(e.target.value) || 0 }))}
              className="h-8 text-[12px] tabular-nums"
            />
          </div>
        ))}
        <p className="text-[10.5px] text-muted-foreground italic">
          Σημ: Τα tiers προμηθειών (αν είναι ενεργά) υπερισχύουν του Admin %.
        </p>
        <Button onClick={save} disabled={busy} size="sm" className="w-full h-9">
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          UPDATE SETTINGS
        </Button>
      </div>
    </div>
  );
}
