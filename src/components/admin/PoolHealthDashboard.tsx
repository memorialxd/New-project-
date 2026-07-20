import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Activity, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck,
  Clock, ArrowDownRight, ArrowUpRight, Loader2,
} from 'lucide-react';

const fmt = (n: number | null | undefined) => `€${Number(n ?? 0).toFixed(2)}`;

type LedgerRow = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  order_id: string | null;
  created_at: string;
};

type Settings = {
  pool_healthy_threshold: number;
  low_pool_threshold: number;
  pool_critical_threshold: number;
  pool_low_multiplier: number;
  pool_critical_multiplier: number;
  base_pay: number;
  per_km_rate: number;
  min_pay: number;
  max_pay: number;
  driver_pool_pct_of_subtotal: number;
  subsidize_min_pay: boolean;
};

export default function PoolHealthDashboard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Pool balance + settings
  const treasury = useQuery({
    queryKey: ['pool-health-treasury'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('admin_treasury')
        .select('platform_pool, lifetime_platform_earned, lifetime_driver_topup, admin_balance')
        .eq('id', 1)
        .maybeSingle();
      return data ?? { platform_pool: 0, lifetime_platform_earned: 0, lifetime_driver_topup: 0, admin_balance: 0 };
    },
    refetchInterval: 30_000,
  });

  const settings = useQuery({
    queryKey: ['pool-health-settings'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('platform_settings')
        .select('pool_healthy_threshold, low_pool_threshold, pool_critical_threshold, pool_low_multiplier, pool_critical_multiplier, base_pay, per_km_rate, min_pay, max_pay, driver_pool_pct_of_subtotal, subsidize_min_pay')
        .eq('id', 1)
        .maybeSingle();
      return (data ?? {}) as Partial<Settings>;
    },
  });

  // Last 7 days of pool ledger movement (driver_pool in, driver_bonus / pool_subsidy out)
  const ledger = useQuery({
    queryKey: ['pool-health-ledger'],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await (supabase as any)
        .from('admin_treasury_ledger')
        .select('id, type, amount, description, order_id, created_at')
        .in('type', ['driver_pool', 'driver_bonus', 'pool_subsidy', 'commission_extra', 'driver_topup'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      return (data ?? []) as LedgerRow[];
    },
    refetchInterval: 30_000,
  });

  // Recent driver bonuses (per-order)
  const recentBonuses = useQuery({
    queryKey: ['pool-health-recent-bonuses'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('orders')
        .select('id, driver_id, distance_km, driver_pool_bonus, delivery_fee, tip_amount, total_amount, created_at, commission_settled_at')
        .gt('driver_pool_bonus', 0)
        .order('commission_settled_at', { ascending: false })
        .limit(25);
      return (data ?? []) as any[];
    },
    refetchInterval: 30_000,
  });

  const s = settings.data ?? {};
  const pool = Number(treasury.data?.platform_pool ?? 0);
  const healthy = Number(s.pool_healthy_threshold ?? 500);
  const low = Number(s.low_pool_threshold ?? 50);
  const critical = Number(s.pool_critical_threshold ?? 20);

  const { healthLabel, healthTone, multiplier, healthPct } = useMemo(() => {
    if (pool >= healthy) return { healthLabel: 'Υγιές', healthTone: 'success', multiplier: 1.0, healthPct: 100 };
    if (pool >= low) return { healthLabel: 'Κανονικό', healthTone: 'normal', multiplier: 1.0, healthPct: Math.min(100, (pool / healthy) * 100) };
    if (pool >= critical) return { healthLabel: 'Χαμηλό', healthTone: 'warn', multiplier: Number(s.pool_low_multiplier ?? 0.85), healthPct: Math.max(20, (pool / healthy) * 100) };
    return { healthLabel: 'Κρίσιμο', healthTone: 'danger', multiplier: Number(s.pool_critical_multiplier ?? 0.6), healthPct: Math.max(8, (pool / healthy) * 100) };
  }, [pool, healthy, low, critical, s.pool_low_multiplier, s.pool_critical_multiplier]);

  const { inflow7d, outflow7d, subsidy7d, bonusesCount, avgBonus, avgInflow, netPerDay, daysToEmpty } = useMemo(() => {
    const rows = ledger.data ?? [];
    let inflow = 0, outflow = 0, subsidy = 0, bonuses = 0, bonusSum = 0, inflowEvents = 0;
    for (const r of rows) {
      const a = Number(r.amount);
      if (r.type === 'driver_pool' || r.type === 'commission_extra') {
        inflow += a;
        inflowEvents++;
      } else if (r.type === 'driver_bonus') {
        outflow += -a; // negative entries
        bonuses++;
        bonusSum += -a;
      } else if (r.type === 'pool_subsidy') {
        subsidy += -a;
      } else if (r.type === 'driver_topup') {
        outflow += -a;
      }
    }
    const days = 7;
    const net = (inflow - outflow) / days;
    const dte = net < 0 && pool > 0 ? Math.max(0, pool / -net) : null;
    return {
      inflow7d: inflow,
      outflow7d: outflow,
      subsidy7d: subsidy,
      bonusesCount: bonuses,
      avgBonus: bonuses > 0 ? bonusSum / bonuses : 0,
      avgInflow: inflowEvents > 0 ? inflow / inflowEvents : 0,
      netPerDay: net,
      daysToEmpty: dte,
    };
  }, [ledger.data, pool]);

  // Per-day buckets for last 7 days
  const dailySeries = useMemo(() => {
    const buckets: Record<string, { in: number; out: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = format(d, 'dd/MM');
      buckets[key] = { in: 0, out: 0 };
    }
    for (const r of ledger.data ?? []) {
      const key = format(new Date(r.created_at), 'dd/MM');
      if (!buckets[key]) continue;
      const a = Number(r.amount);
      if (r.type === 'driver_pool' || r.type === 'commission_extra') buckets[key].in += a;
      else if (r.type === 'driver_bonus' || r.type === 'driver_topup') buckets[key].out += -a;
    }
    const max = Math.max(1, ...Object.values(buckets).flatMap(b => [b.in, b.out]));
    return Object.entries(buckets).map(([day, b]) => ({ day, ...b, max }));
  }, [ledger.data, now]);

  // Fairness check: do bonuses match the formula? Flag outliers.
  const fairnessRows = useMemo(() => {
    const rows = recentBonuses.data ?? [];
    const base = Number(s.base_pay ?? 3);
    const perKm = Number(s.per_km_rate ?? 0.5);
    const minP = Number(s.min_pay ?? 3);
    const maxP = Number(s.max_pay ?? 12);
    return rows.map((o: any) => {
      const km = Number(o.distance_km ?? 0);
      const raw = base + perKm * km;
      const clamped = Math.min(Math.max(raw, minP), maxP);
      const expected = Math.max(clamped * multiplier, minP);
      const actual = Number(o.driver_pool_bonus ?? 0);
      const delta = actual - expected;
      const fair = Math.abs(delta) < 0.5;
      return { ...o, km, expected, actual, delta, fair };
    });
  }, [recentBonuses.data, s, multiplier]);

  if (treasury.isLoading || settings.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const toneClasses: Record<string, { bg: string; text: string; ring: string; chip: string }> = {
    success: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', ring: 'ring-emerald-500/30', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    normal:  { bg: 'bg-primary/10',     text: 'text-primary',                            ring: 'ring-primary/30',     chip: 'bg-primary/15 text-primary' },
    warn:    { bg: 'bg-amber-500/10',   text: 'text-amber-700 dark:text-amber-400',     ring: 'ring-amber-500/30',   chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    danger:  { bg: 'bg-destructive/10', text: 'text-destructive',                        ring: 'ring-destructive/30', chip: 'bg-destructive/15 text-destructive' },
  };
  const tc = toneClasses[healthTone];

  return (
    <div className="space-y-4">
      {/* Hero: pool balance + health */}
      <Card className={`ring-1 ${tc.ring}`}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-xs font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Driver Pool — τρέχον υπόλοιπο
              </p>
              <p className={`font-heading font-bold text-4xl sm:text-5xl mt-1 ${tc.text}`}>{fmt(pool)}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge className={`${tc.chip} border-0 font-heading uppercase text-[10px] tracking-wider`}>{healthLabel}</Badge>
                <span className="text-xs text-muted-foreground">multiplier ενεργό: <b className="text-foreground">×{multiplier.toFixed(2)}</b></span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground sm:text-right space-y-0.5">
              <p>Lifetime εισροή: <b className="text-foreground">{fmt(treasury.data?.lifetime_platform_earned)}</b></p>
              <p>Lifetime εκροή σε οδηγούς: <b className="text-foreground">{fmt(treasury.data?.lifetime_driver_topup)}</b></p>
            </div>
          </div>

          {/* Threshold ladder */}
          <div className="mt-5 space-y-2">
            <div className="flex justify-between text-[11px] text-muted-foreground font-heading uppercase tracking-wider">
              <span>0</span>
              <span>critical {fmt(critical)}</span>
              <span>low {fmt(low)}</span>
              <span>healthy {fmt(healthy)}+</span>
            </div>
            <Progress value={healthPct} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={ArrowUpRight} tone="success" label="Εισροή 7 ημερών" value={fmt(inflow7d)} hint={`avg ${fmt(avgInflow)} / order`} />
        <Kpi icon={ArrowDownRight} tone="warn" label="Εκροή 7 ημερών" value={fmt(outflow7d)} hint={`${bonusesCount} bonuses · avg ${fmt(avgBonus)}`} />
        <Kpi
          icon={netPerDay >= 0 ? TrendingUp : TrendingDown}
          tone={netPerDay >= 0 ? 'success' : 'danger'}
          label="Καθαρό / ημέρα"
          value={`${netPerDay >= 0 ? '+' : ''}${fmt(netPerDay)}`}
          hint={netPerDay >= 0 ? 'Pool μεγαλώνει' : 'Pool μειώνεται'}
        />
        <Kpi
          icon={Clock}
          tone={daysToEmpty == null ? 'success' : daysToEmpty > 14 ? 'normal' : daysToEmpty > 5 ? 'warn' : 'danger'}
          label="Projected solvency"
          value={daysToEmpty == null ? '∞' : `${daysToEmpty.toFixed(1)} ημέρες`}
          hint={daysToEmpty == null ? 'με τρέχον ρυθμό' : 'μέχρι το pool αδειάσει'}
        />
      </div>

      {/* Subsidy alert */}
      {subsidy7d > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <p className="font-bold text-amber-700 dark:text-amber-400">
              Admin bag κάλυψε {fmt(subsidy7d)} τις τελευταίες 7 ημέρες
            </p>
            <p className="text-muted-foreground mt-0.5">
              Το pool δεν επαρκούσε για το ελάχιστο payout οδηγού. Σκέψου να ανεβάσεις commission % ή να μειώσεις το base/per-km.
            </p>
          </div>
        </div>
      )}

      {/* 7-day bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm">Ροή Pool — τελευταίες 7 ημέρες</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {dailySeries.map(({ day, in: i, out, max }) => (
              <div key={day} className="flex flex-col items-center gap-1">
                <div className="h-28 w-full flex items-end justify-center gap-1">
                  <div
                    className="w-2.5 rounded-t bg-emerald-500/70 transition-all"
                    style={{ height: `${(i / max) * 100}%` }}
                    title={`Εισροή ${fmt(i)}`}
                  />
                  <div
                    className="w-2.5 rounded-t bg-amber-500/70 transition-all"
                    style={{ height: `${(out / max) * 100}%` }}
                    title={`Εκροή ${fmt(out)}`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{day}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500/70" /> Εισροή</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-500/70" /> Εκροή σε οδηγούς</span>
          </div>
        </CardContent>
      </Card>

      {/* Fairness audit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Έλεγχος Δικαιοσύνης — τελευταία 25 bonuses
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Σύγκριση πραγματικού bonus με τον αναμενόμενο τύπο (base + per_km × km, clamped, × multiplier). Διαφορά &gt; €0.50 = ⚠️.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Παραγγελία</TableHead>
                  <TableHead className="text-xs">Όταν</TableHead>
                  <TableHead className="text-xs text-right">Χλμ</TableHead>
                  <TableHead className="text-xs text-right">Αναμενόμενο</TableHead>
                  <TableHead className="text-xs text-right">Πραγματικό</TableHead>
                  <TableHead className="text-xs text-right">Διαφορά</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fairnessRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">Καμία παράδοση με bonus ακόμα.</TableCell></TableRow>
                ) : fairnessRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-[11px]">{r.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.commission_settled_at ? format(new Date(r.commission_settled_at), 'dd/MM HH:mm') : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{r.km.toFixed(1)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmt(r.expected)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums font-semibold">{fmt(r.actual)}</TableCell>
                    <TableCell className={`text-xs text-right tabular-nums ${Math.abs(r.delta) < 0.01 ? 'text-muted-foreground' : r.delta > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {r.delta >= 0 ? '+' : ''}{fmt(r.delta)}
                    </TableCell>
                    <TableCell>
                      {r.fair ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px]">OK</Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0 text-[10px]">⚠️ Έλεγξε</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, tone, label, value, hint }: { icon: any; tone: 'success'|'normal'|'warn'|'danger'; label: string; value: string; hint?: string }) {
  const colors: Record<string, string> = {
    success: 'text-emerald-600 bg-emerald-500/10',
    normal:  'text-primary bg-primary/10',
    warn:    'text-amber-600 bg-amber-500/10',
    danger:  'text-destructive bg-destructive/10',
  };
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-start gap-2.5">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${colors[tone]}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="font-heading font-bold text-lg text-foreground tabular-nums leading-tight mt-0.5">{value}</p>
            {hint && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
