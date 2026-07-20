import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Circle as XCircle, Loader as Loader2, RefreshCw, Wrench, Stethoscope, Database, Zap, MapPin, ShoppingBag, Bike, Wallet, Receipt, Truck, Bell, CreditCard, Clock, Users, Store, Activity, FileWarning, Trash2, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Status = 'ok' | 'warn' | 'error' | 'checking';
type Group = 'core' | 'orders' | 'drivers' | 'stores' | 'money' | 'data';

interface CheckResult {
  id: string;
  group: Group;
  label: string;
  icon: any;
  status: Status;
  message: string;
  fix?: () => Promise<void>;
  fixLabel?: string;
}

const tone: Record<Status, { dot: string; bg: string; text: string; Icon: any; label: string }> = {
  ok:       { dot: 'bg-success', bg: 'bg-success/10', text: 'text-success', Icon: CheckCircle2, label: 'OK' },
  warn:     { dot: 'bg-warning', bg: 'bg-warning/10', text: 'text-warning', Icon: AlertTriangle, label: 'Warning' },
  error:    { dot: 'bg-destructive', bg: 'bg-destructive/10', text: 'text-destructive', Icon: XCircle, label: 'Error' },
  checking: { dot: 'bg-muted-foreground', bg: 'bg-muted', text: 'text-muted-foreground', Icon: Loader2, label: '…' },
};

const GROUP_META: Record<Group, { label: string; icon: any }> = {
  core:    { label: 'Σύστημα',        icon: Activity },
  orders:  { label: 'Παραγγελίες',    icon: ShoppingBag },
  drivers: { label: 'Οδηγοί',         icon: Bike },
  stores:  { label: 'Καταστήματα',    icon: Store },
  money:   { label: 'Οικονομικά',     icon: Wallet },
  data:    { label: 'Καθαρισμός',     icon: Trash2 },
};

export default function SystemDoctorPanel() {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [fixingAll, setFixingAll] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const r: CheckResult[] = [];

    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

    // ========== CORE ==========
    try {
      const t0 = performance.now();
      const { error } = await supabase.from('platform_settings').select('id').limit(1);
      const ms = Math.round(performance.now() - t0);
      r.push({ id: 'db', group: 'core', label: 'Βάση δεδομένων', icon: Database,
        status: error ? 'error' : ms > 1500 ? 'warn' : 'ok',
        message: error ? error.message : `Απόκριση ${ms}ms` });
    } catch (e: any) {
      r.push({ id: 'db', group: 'core', label: 'Βάση δεδομένων', icon: Database, status: 'error', message: e?.message ?? 'fail' });
    }

    try {
      const { data } = await (supabase as any).from('platform_settings').select('maintenance_mode').eq('id', 1).maybeSingle();
      const on = !!data?.maintenance_mode;
      r.push({ id: 'maintenance', group: 'core', label: 'Maintenance mode', icon: Wrench,
        status: on ? 'warn' : 'ok',
        message: on ? 'Ενεργή — χρήστες βλέπουν banner' : 'Off',
        fix: on ? async () => {
          const { error } = await (supabase as any).from('platform_settings').update({ maintenance_mode: false }).eq('id', 1);
          if (error) throw error;
        } : undefined, fixLabel: 'Off' });
    } catch (e: any) {
      r.push({ id: 'maintenance', group: 'core', label: 'Maintenance mode', icon: Wrench, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data, error } = await supabase.functions.invoke('get-mapbox-token');
      r.push({ id: 'mapbox', group: 'core', label: 'Mapbox token', icon: MapPin,
        status: error || !(data as any)?.token ? 'error' : 'ok',
        message: error ? error.message : (data as any)?.token ? 'Active' : 'Missing MAPBOX_PUBLIC_TOKEN' });
    } catch (e: any) {
      r.push({ id: 'mapbox', group: 'core', label: 'Mapbox token', icon: MapPin, status: 'error', message: e?.message ?? 'fail' });
    }

    r.push({ id: 'network', group: 'core', label: 'Σύνδεση δικτύου', icon: Activity,
      status: navigator.onLine ? 'ok' : 'error',
      message: navigator.onLine ? 'Online' : 'Offline' });

    // ========== ORDERS ==========
    try {
      const { data } = await supabase.from('orders').select('id')
        .in('status', ['placed', 'accepted', 'preparing'] as any).lt('created_at', ago(2 * 3600_000));
      const ids = (data ?? []).map((o: any) => o.id);
      r.push({ id: 'stuck_orders', group: 'orders', label: 'Παγωμένες παραγγελίες >2h', icon: ShoppingBag,
        status: ids.length === 0 ? 'ok' : ids.length > 5 ? 'error' : 'warn',
        message: ids.length === 0 ? 'Καμία' : `${ids.length} παραγγελίες κολλημένες`,
        fix: ids.length > 0 ? async () => {
          const { error } = await supabase.from('orders').update({ status: 'cancelled' as any }).in('id', ids);
          if (error) throw error;
        } : undefined, fixLabel: 'Ακύρωση' });
    } catch (e: any) {
      r.push({ id: 'stuck_orders', group: 'orders', label: 'Παγωμένες παραγγελίες', icon: ShoppingBag, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await supabase.from('orders').select('id')
        .eq('status', 'ready' as any).is('driver_id', null).lt('created_at', ago(20 * 60_000));
      const ids = (data ?? []).map((o: any) => o.id);
      r.push({ id: 'unassigned', group: 'orders', label: 'Έτοιμες χωρίς οδηγό >20min', icon: Truck,
        status: ids.length === 0 ? 'ok' : 'warn',
        message: ids.length === 0 ? 'Καμία' : `${ids.length} παραγγελίες χωρίς ανάθεση`,
        fix: ids.length > 0 ? async () => {
          await supabase.functions.invoke('auto-dispatch', { body: { force: true } });
        } : undefined, fixLabel: 'Re-dispatch' });
    } catch (e: any) {
      r.push({ id: 'unassigned', group: 'orders', label: 'Έτοιμες χωρίς οδηγό', icon: Truck, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await supabase.from('orders').select('id, total_km').is('total_km', null)
        .gte('created_at', ago(7 * 24 * 3600_000));
      r.push({ id: 'missing_km', group: 'orders', label: 'Παραγγελίες χωρίς km (7d)', icon: MapPin,
        status: !data?.length ? 'ok' : 'warn',
        message: !data?.length ? 'OK' : `${data.length} χωρίς υπολογισμένα χλμ`,
        fix: data?.length ? async () => {
          await (supabase as any).rpc('backfill_orders_km');
        } : undefined, fixLabel: 'Backfill' });
    } catch (e: any) {
      r.push({ id: 'missing_km', group: 'orders', label: 'Παραγγελίες χωρίς km', icon: MapPin, status: 'warn', message: e?.message ?? '?' });
    }

    // ========== DRIVERS ==========
    try {
      const { data: active } = await supabase.from('driver_profiles').select('user_id').eq('is_active', true);
      const ids = (active ?? []).map((d: any) => d.user_id);
      let stale: any[] = [];
      if (ids.length) {
        const { data } = await supabase.from('driver_locations').select('driver_id').in('driver_id', ids).lt('updated_at', ago(10 * 60_000));
        stale = data ?? [];
      }
      r.push({ id: 'stale_drivers', group: 'drivers', label: 'Ενεργοί χωρίς ping >10min', icon: Bike,
        status: stale.length === 0 ? 'ok' : 'warn',
        message: stale.length === 0 ? 'Όλοι αναφέρουν θέση' : `${stale.length} οδηγοί χωρίς σήμα`,
        fix: stale.length > 0 ? async () => {
          const sids = stale.map((d: any) => d.driver_id);
          const { error } = await supabase.from('driver_locations').delete().in('driver_id', sids);
          if (error) throw error;
        } : undefined, fixLabel: 'Καθαρισμός' });
    } catch (e: any) {
      r.push({ id: 'stale_drivers', group: 'drivers', label: 'Stale οδηγοί', icon: Bike, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await (supabase as any).from('driver_state').select('driver_id, on_break, last_break_at')
        .eq('on_break', true).lt('last_break_at', ago(60 * 60_000));
      r.push({ id: 'long_breaks', group: 'drivers', label: 'Οδηγοί σε διάλειμμα >1h', icon: Clock,
        status: !data?.length ? 'ok' : 'warn',
        message: !data?.length ? 'Καμία' : `${data.length} σε παρατεταμένο break`,
        fix: data?.length ? async () => {
          const ids = data.map((d: any) => d.driver_id);
          const { error } = await (supabase as any).from('driver_state').update({ on_break: false }).in('driver_id', ids);
          if (error) throw error;
        } : undefined, fixLabel: 'Επαναφορά' });
    } catch (e: any) {
      r.push({ id: 'long_breaks', group: 'drivers', label: 'Long breaks', icon: Clock, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data: offers } = await (supabase as any).from('dispatch_offers').select('id')
        .eq('status', 'pending').lt('expires_at', new Date().toISOString());
      r.push({ id: 'expired_offers', group: 'drivers', label: 'Ληγμένα offers', icon: Bell,
        status: !offers?.length ? 'ok' : 'warn',
        message: !offers?.length ? 'Καθαρά' : `${offers.length} pending offers ληγμένα`,
        fix: offers?.length ? async () => {
          const ids = offers.map((o: any) => o.id);
          const { error } = await (supabase as any).from('dispatch_offers').update({ status: 'expired' }).in('id', ids);
          if (error) throw error;
        } : undefined, fixLabel: 'Mark expired' });
    } catch (e: any) {
      r.push({ id: 'expired_offers', group: 'drivers', label: 'Expired offers', icon: Bell, status: 'warn', message: e?.message ?? '?' });
    }

    // ========== STORES ==========
    try {
      const { data } = await supabase.from('stores').select('id, name, latitude, longitude');
      const bad = (data ?? []).filter((s: any) => !s.latitude || !s.longitude);
      r.push({ id: 'store_coords', group: 'stores', label: 'Καταστήματα χωρίς συντεταγμένες', icon: MapPin,
        status: bad.length === 0 ? 'ok' : 'warn',
        message: bad.length === 0 ? 'Όλα γεωκωδικοποιημένα' : `${bad.length} χωρίς lat/lng` });
    } catch (e: any) {
      r.push({ id: 'store_coords', group: 'stores', label: 'Store coords', icon: MapPin, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await supabase.from('stores').select('id, is_active').eq('is_active', true);
      r.push({ id: 'active_stores', group: 'stores', label: 'Ενεργά καταστήματα', icon: Store,
        status: !data?.length ? 'warn' : 'ok',
        message: !data?.length ? 'Κανένα ενεργό!' : `${data.length} ενεργά` });
    } catch (e: any) {
      r.push({ id: 'active_stores', group: 'stores', label: 'Ενεργά καταστήματα', icon: Store, status: 'warn', message: e?.message ?? '?' });
    }

    // ========== MONEY ==========
    try {
      const { data } = await (supabase as any).from('admin_treasury').select('platform_pool').eq('id', 1).maybeSingle();
      const pool = Number(data?.platform_pool ?? 0);
      const status: Status = pool < 20 ? 'error' : pool < 50 ? 'warn' : 'ok';
      r.push({ id: 'basket', group: 'money', label: 'Driver Basket', icon: Wallet, status,
        message: `€${pool.toFixed(2)} στο ταμείο` });
    } catch (e: any) {
      r.push({ id: 'basket', group: 'money', label: 'Driver Basket', icon: Wallet, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await supabase.from('orders').select('id')
        .eq('status', 'delivered' as any).is('commission_settled_at', null).lt('created_at', ago(3600_000));
      const ids = (data ?? []).map((o: any) => o.id);
      r.push({ id: 'unsettled', group: 'money', label: 'Παραδοθείσες χωρίς settlement', icon: Receipt,
        status: ids.length === 0 ? 'ok' : 'warn',
        message: ids.length === 0 ? 'Όλες τακτοποιημένες' : `${ids.length} εκκρεμούν >1h`,
        fix: ids.length > 0 ? async () => {
          for (const id of ids) await (supabase as any).rpc('settle_order_now', { _order_id: id }).catch(() => {});
        } : undefined, fixLabel: 'Settle' });
    } catch (e: any) {
      r.push({ id: 'unsettled', group: 'money', label: 'Settlements', icon: Receipt, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await (supabase as any).from('driver_state').select('driver_id, shift_cash_balance').gt('shift_cash_balance', 200);
      r.push({ id: 'cash_overload', group: 'money', label: 'Οδηγοί με >€200 μετρητά', icon: CreditCard,
        status: !data?.length ? 'ok' : 'warn',
        message: !data?.length ? 'OK' : `${data.length} οδηγοί ξεπερνούν cash limit` });
    } catch (e: any) {
      r.push({ id: 'cash_overload', group: 'money', label: 'Cash limit', icon: CreditCard, status: 'warn', message: e?.message ?? '?' });
    }

    // ========== DATA / CLEANUP ==========
    try {
      const { data } = await (supabase as any).from('dispatch_runs').select('id').lt('created_at', ago(24 * 3600_000)).limit(500);
      r.push({ id: 'old_runs', group: 'data', label: 'Παλιά dispatch_runs >24h', icon: Trash2,
        status: !data?.length ? 'ok' : data.length > 200 ? 'warn' : 'ok',
        message: !data?.length ? 'Καθαρό' : `${data.length}+ εγγραφές για καθαρισμό`,
        fix: data?.length ? async () => {
          const { error } = await (supabase as any).from('dispatch_runs').delete().lt('created_at', ago(24 * 3600_000));
          if (error) throw error;
        } : undefined, fixLabel: 'Purge' });
    } catch (e: any) {
      r.push({ id: 'old_runs', group: 'data', label: 'Παλιά dispatch_runs', icon: Trash2, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { data } = await (supabase as any).from('dispatch_offers').select('id')
        .in('status', ['declined', 'expired']).lt('created_at', ago(48 * 3600_000)).limit(500);
      r.push({ id: 'old_offers', group: 'data', label: 'Παλιά offers >48h', icon: FileWarning,
        status: !data?.length ? 'ok' : 'ok',
        message: !data?.length ? 'Καθαρό' : `${data.length}+ έτοιμα για καθαρισμό`,
        fix: data?.length ? async () => {
          const { error } = await (supabase as any).from('dispatch_offers').delete()
            .in('status', ['declined', 'expired']).lt('created_at', ago(48 * 3600_000));
          if (error) throw error;
        } : undefined, fixLabel: 'Purge' });
    } catch (e: any) {
      r.push({ id: 'old_offers', group: 'data', label: 'Παλιά offers', icon: FileWarning, status: 'warn', message: e?.message ?? '?' });
    }

    try {
      const { count } = await (supabase as any).from('audit_log').select('id', { count: 'exact', head: true })
        .lt('created_at', ago(90 * 24 * 3600_000));
      r.push({ id: 'old_audit', group: 'data', label: 'Audit log >90d', icon: FileWarning,
        status: !count ? 'ok' : 'ok',
        message: !count ? 'Καθαρό' : `${count} παλιές εγγραφές`,
        fix: count ? async () => {
          const { error } = await (supabase as any).from('audit_log').delete().lt('created_at', ago(90 * 24 * 3600_000));
          if (error) throw error;
        } : undefined, fixLabel: 'Purge' });
    } catch (e: any) {
      r.push({ id: 'old_audit', group: 'data', label: 'Audit log', icon: FileWarning, status: 'warn', message: e?.message ?? '?' });
    }

    // Edge function reachability
    const pingFn = async (name: string) => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
      const t0 = performance.now();
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) return { status: 0, ms: 0 };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ping: true }),
      });
      await res.text().catch(() => '');
      return { status: res.status, ms: Math.round(performance.now() - t0) };
    };

    for (const fn of ['auto-dispatch', 'support-ai', 'predict-dispatch-time']) {
      try {
        const { status, ms } = await pingFn(fn);
        const reachable = status > 0 && status < 500;
        r.push({ id: `fn_${fn}`, group: 'core', label: `Edge: ${fn}`, icon: Zap,
          status: reachable ? 'ok' : 'warn',
          message: reachable ? `${ms}ms` : `HTTP ${status}` });
      } catch (e: any) {
        r.push({ id: `fn_${fn}`, group: 'core', label: `Edge: ${fn}`, icon: Zap, status: 'warn', message: e?.message ?? '?' });
      }
    }

    setChecks(r);
    setLastRun(new Date());
    setRunning(false);
  }, []);

  useEffect(() => { void runChecks(); }, [runChecks]);

  const runFix = async (c: CheckResult) => {
    if (!c.fix) return;
    try { await c.fix(); toast.success(`${c.label}: OK`); void runChecks(); }
    catch (e: any) { toast.error(`${c.label}: ${e?.message ?? 'Failed'}`); }
  };

  const issues = checks.filter(c => c.status !== 'ok' && c.status !== 'checking');
  const fixable = issues.filter(c => !!c.fix);
  const overall: Status = checks.length === 0 ? 'checking'
    : checks.some(c => c.status === 'error') ? 'error'
    : checks.some(c => c.status === 'warn') ? 'warn' : 'ok';

  const fixAll = async () => {
    setFixingAll(true);
    let ok = 0, fail = 0;
    for (const c of fixable) {
      try { await c.fix!(); ok++; } catch { fail++; }
    }
    setFixingAll(false);
    if (ok) toast.success(`Επιδιορθώθηκαν ${ok}`);
    if (fail) toast.error(`${fail} απέτυχαν`);
    void runChecks();
  };

  const Big = tone[overall].Icon;
  const groups: Group[] = ['core', 'orders', 'drivers', 'stores', 'money', 'data'];

  return (
    <div className="space-y-3">
      <div className="admin-section-header">
        <div>
          <h2 className="admin-section-title flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            System Doctor
          </h2>
          <p className="admin-section-sub mt-0.5">
            End-to-end διάγνωση όλης της πλατφόρμας με one-click επιδιορθώσεις
            {lastRun && <> · τελευταίος έλεγχος {lastRun.toLocaleTimeString('el-GR')}</>}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={runChecks} disabled={running} className="h-8 gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
          Επανέλεγχος
        </Button>
      </div>

      {/* Hero */}
      <div className={cn('admin-card p-4 flex items-center gap-4', tone[overall].bg)}>
        <div className={cn('h-12 w-12 rounded-full flex items-center justify-center bg-card shadow-sm', tone[overall].text)}>
          <Big className={cn('h-6 w-6', overall === 'checking' && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold">
              {overall === 'ok' && 'Όλα τα συστήματα λειτουργούν'}
              {overall === 'warn' && 'Εντοπίστηκαν προειδοποιήσεις'}
              {overall === 'error' && 'Εντοπίστηκαν προβλήματα'}
              {overall === 'checking' && 'Έλεγχος σε εξέλιξη…'}
            </h3>
            <Badge variant="outline" className={cn('text-[10.5px] h-5', tone[overall].text)}>
              {checks.filter(c => c.status === 'ok').length}/{checks.length} OK
            </Badge>
          </div>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            {issues.length === 0 ? 'Καμία απαιτούμενη ενέργεια.'
              : `${issues.length} ${issues.length === 1 ? 'πρόβλημα' : 'προβλήματα'}${fixable.length ? ` · ${fixable.length} με αυτόματη επιδιόρθωση` : ''}.`}
          </p>
        </div>
        {fixable.length > 0 && (
          <Button size="sm" onClick={fixAll} disabled={fixingAll} className="gap-1.5">
            {fixingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
            Διόρθωσε όλα ({fixable.length})
          </Button>
        )}
      </div>

      {/* Grouped checks */}
      {groups.map(g => {
        const items = checks.filter(c => c.group === g);
        if (!items.length) return null;
        const GIcon = GROUP_META[g].icon;
        const groupIssues = items.filter(c => c.status !== 'ok' && c.status !== 'checking').length;
        return (
          <div key={g} className="space-y-2">
            <div className="flex items-center gap-2 px-1 pt-2">
              <GIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{GROUP_META[g].label}</h3>
              {groupIssues > 0 && (
                <Badge variant="outline" className="text-[10px] h-4.5 text-warning border-warning/40">{groupIssues}</Badge>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map(c => {
                const t = tone[c.status];
                const TIcon = t.Icon;
                return (
                  <div key={c.id} className="admin-card p-3 flex items-start gap-3">
                    <div className={cn('h-9 w-9 rounded-md flex items-center justify-center shrink-0', t.bg)}>
                      <c.icon className={cn('h-4 w-4', t.text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-[13px] font-semibold truncate">{c.label}</h4>
                        <span className={cn('inline-flex items-center gap-1 text-[10.5px] font-medium', t.text)}>
                          <TIcon className={cn('h-3 w-3', c.status === 'checking' && 'animate-spin')} />
                          {t.label}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug truncate">{c.message}</p>
                    </div>
                    {c.fix && c.status !== 'ok' && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] shrink-0" onClick={() => runFix(c)}>
                        <Wrench className="h-3 w-3 mr-1" />
                        {c.fixLabel ?? 'Fix'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {checks.length === 0 && running && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Εκτέλεση διαγνωστικών…
        </div>
      )}
    </div>
  );
}
