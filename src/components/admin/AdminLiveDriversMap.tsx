import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Bike, Search, Wallet, Coins, Target, Clock, Activity, MapPin } from 'lucide-react';
import AdminDriversMap from './AdminDriversMap';
import { formatDistanceToNow } from 'date-fns';

interface DriverRow {
  user_id: string;
  full_name: string | null;
  driver_code: string | null;
  is_active: boolean;
  on_break: boolean;
  shift_started_at: string | null;
  shift_cash_balance: number;
  daily_goal: number;
  available_balance: number;
  pending_balance: number;
  last_location_at: string | null;
  todays_deliveries: number;
  todays_earnings: number;
  active_order_status: string | null;
}

export default function AdminLiveDriversMap() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const iso = todayStart.toISOString();

      const [
        { data: profiles },
        { data: dProfiles },
        { data: states },
        { data: wallets },
        { data: locs },
        { data: todayEarnings },
        { data: activeOrders },
      ] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').eq('role', 'driver' as any),
        supabase.from('driver_profiles').select('user_id, driver_code, is_active' as any),
        supabase.from('driver_state').select('driver_id, on_break, shift_started_at, shift_cash_balance, daily_goal'),
        supabase.from('driver_wallets').select('driver_id, available_balance, pending_balance'),
        supabase.from('driver_locations').select('driver_id, updated_at'),
        supabase.from('earnings').select('driver_id, total, base_pay, tip, bonus, created_at').gte('created_at', iso),
        supabase.from('orders').select('driver_id, status').in('status', ['accepted','preparing','ready','arrived','picked_up'] as any),
      ]);

      const stateMap = new Map((states ?? []).map((s: any) => [s.driver_id, s]));
      const walletMap = new Map((wallets ?? []).map((w: any) => [w.driver_id, w]));
      const dpMap = new Map((dProfiles as any[] ?? []).map((d: any) => [d.user_id, d]));
      const locMap = new Map((locs ?? []).map((l: any) => [l.driver_id, l.updated_at]));
      const activeMap = new Map((activeOrders as any[] ?? []).map((o: any) => [o.driver_id, o.status]));

      const earnMap = new Map<string, { count: number; total: number }>();
      (todayEarnings as any[] ?? []).forEach((e) => {
        const t = Number(e.total ?? 0) || (Number(e.base_pay ?? 0) + Number(e.tip ?? 0) + Number(e.bonus ?? 0));
        const cur = earnMap.get(e.driver_id) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total += t;
        earnMap.set(e.driver_id, cur);
      });

      const out: DriverRow[] = (profiles ?? []).map((p: any) => {
        const dp = dpMap.get(p.user_id) ?? {};
        const st = stateMap.get(p.user_id) ?? {};
        const w = walletMap.get(p.user_id) ?? {};
        const e = earnMap.get(p.user_id) ?? { count: 0, total: 0 };
        return {
          user_id: p.user_id,
          full_name: p.full_name,
          driver_code: dp.driver_code ?? null,
          is_active: dp.is_active !== false,
          on_break: !!st.on_break,
          shift_started_at: st.shift_started_at ?? null,
          shift_cash_balance: Number(st.shift_cash_balance ?? 0),
          daily_goal: Number(st.daily_goal ?? 0),
          available_balance: Number(w.available_balance ?? 0),
          pending_balance: Number(w.pending_balance ?? 0),
          last_location_at: locMap.get(p.user_id) ?? null,
          todays_deliveries: e.count,
          todays_earnings: e.total,
          active_order_status: activeMap.get(p.user_id) ?? null,
        };
      });

      if (mounted) {
        setRows(out);
        setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 20000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter(r => (r.full_name ?? '').toLowerCase().includes(q) || (r.driver_code ?? '').toLowerCase().includes(q))
      : rows;
    return [...list].sort((a, b) => {
      const aOnline = a.last_location_at && Date.now() - new Date(a.last_location_at).getTime() < 5 * 60 * 1000;
      const bOnline = b.last_location_at && Date.now() - new Date(b.last_location_at).getTime() < 5 * 60 * 1000;
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return b.todays_earnings - a.todays_earnings;
    });
  }, [rows, query]);

  const onlineCount = rows.filter(r => r.last_location_at && Date.now() - new Date(r.last_location_at).getTime() < 5 * 60 * 1000).length;
  const busyCount = rows.filter(r => r.active_order_status).length;
  const totalEarnings = rows.reduce((s, r) => s + r.todays_earnings, 0);
  const totalDeliveries = rows.reduce((s, r) => s + r.todays_deliveries, 0);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5" />Online</div>
          <div className="text-2xl font-bold mt-1">{onlineCount}<span className="text-sm text-muted-foreground font-normal">/{rows.length}</span></div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bike className="h-3.5 w-3.5" />Σε παράδοση</div>
          <div className="text-2xl font-bold mt-1">{busyCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Target className="h-3.5 w-3.5" />Σήμερα παραδόσεις</div>
          <div className="text-2xl font-bold mt-1">{totalDeliveries}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" />Σημερινά κέρδη</div>
          <div className="text-2xl font-bold mt-1">€{totalEarnings.toFixed(2)}</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <AdminDriversMap />
        </div>
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Οδηγοί</span>
              <Badge variant="outline">{filtered.length}</Badge>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-7 h-8 text-xs" placeholder="Αναζήτηση…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[560px]">
              <div className="divide-y">
                {loading && <div className="p-4 text-sm text-muted-foreground">Φόρτωση…</div>}
                {!loading && filtered.length === 0 && <div className="p-4 text-sm text-muted-foreground">Κανένας οδηγός</div>}
                {filtered.map(d => {
                  const online = d.last_location_at && Date.now() - new Date(d.last_location_at).getTime() < 5 * 60 * 1000;
                  const goalPct = d.daily_goal > 0 ? Math.min(100, (d.todays_earnings / d.daily_goal) * 100) : 0;
                  return (
                    <div key={d.user_id} className="p-3 hover:bg-muted/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${online ? 'bg-success animate-pulse' : 'bg-muted-foreground/40'}`} />
                            <span className="font-medium text-sm truncate">{d.full_name || d.user_id.slice(0, 8)}</span>
                            {d.driver_code && <span className="text-[10px] text-muted-foreground">{d.driver_code}</span>}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {!d.is_active && <Badge variant="destructive" className="text-[10px] h-4">Ανενεργός</Badge>}
                            {d.on_break && <Badge variant="outline" className="text-[10px] h-4">Διάλειμμα</Badge>}
                            {d.active_order_status && <Badge className="text-[10px] h-4 bg-primary">{d.active_order_status}</Badge>}
                            {online && !d.active_order_status && d.is_active && !d.on_break && (
                              <Badge variant="outline" className="text-[10px] h-4 border-success text-success">Διαθέσιμος</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-sm">€{d.todays_earnings.toFixed(2)}</div>
                          <div className="text-[10px] text-muted-foreground">{d.todays_deliveries} παρ.</div>
                        </div>
                      </div>

                      {d.daily_goal > 0 && (
                        <div className="mt-2">
                          <div className="h-1.5 bg-muted rounded overflow-hidden">
                            <div className="h-full bg-success" style={{ width: `${goalPct}%` }} />
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">Στόχος ημέρας: €{d.daily_goal.toFixed(0)} ({goalPct.toFixed(0)}%)</div>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-1 mt-2 text-[10px]">
                        <div className="flex items-center gap-1" title="Πορτοφόλι">
                          <Wallet className="h-3 w-3 text-muted-foreground" />
                          €{d.available_balance.toFixed(2)}
                        </div>
                        <div className="flex items-center gap-1" title="Μετρητά βάρδιας">
                          <Coins className="h-3 w-3 text-muted-foreground" />
                          €{d.shift_cash_balance.toFixed(2)}
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground" title="Τελευταία θέση">
                          <MapPin className="h-3 w-3" />
                          {d.last_location_at ? formatDistanceToNow(new Date(d.last_location_at), { addSuffix: false }) : '—'}
                        </div>
                      </div>
                      {d.shift_started_at && (
                        <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Βάρδια: {formatDistanceToNow(new Date(d.shift_started_at))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
