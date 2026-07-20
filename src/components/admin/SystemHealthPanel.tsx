import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Circle as XCircle, Loader as Loader2, RefreshCw, Wrench, Database, Zap, MapPin, Sparkles, Wifi, ShoppingBag, Bike } from 'lucide-react';
import { cn } from '@/lib/utils';

type Status = 'ok' | 'warn' | 'error' | 'checking';

interface CheckResult {
  id: string;
  label: string;
  icon: typeof Database;
  status: Status;
  message: string;
  /** Optional auto-fix handler. If present and status !== 'ok', a "Fix" button is shown. */
  fix?: () => Promise<void>;
  fixLabel?: string;
}

const tone: Record<Status, { dot: string; bg: string; text: string; Icon: typeof CheckCircle2; label: string }> = {
  ok:       { dot: 'bg-success',    bg: 'bg-success/10',    text: 'text-success',    Icon: CheckCircle2, label: 'Operational' },
  warn:     { dot: 'bg-warning',    bg: 'bg-warning/10',    text: 'text-warning',    Icon: AlertTriangle, label: 'Degraded' },
  error:    { dot: 'bg-destructive', bg: 'bg-destructive/10', text: 'text-destructive', Icon: XCircle,      label: 'Down' },
  checking: { dot: 'bg-muted-foreground', bg: 'bg-muted', text: 'text-muted-foreground', Icon: Loader2,    label: 'Checking…' },
};

export default function SystemHealthPanel() {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [fixingAll, setFixingAll] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const results: CheckResult[] = [];

    // 1. Database connectivity
    try {
      const t0 = performance.now();
      const { error } = await supabase.from('platform_settings').select('id').limit(1);
      const ms = Math.round(performance.now() - t0);
      results.push({
        id: 'db', label: 'Βάση δεδομένων', icon: Database,
        status: error ? 'error' : ms > 1500 ? 'warn' : 'ok',
        message: error ? error.message : `Απόκριση ${ms}ms`,
      });
    } catch (e: any) {
      results.push({ id: 'db', label: 'Βάση δεδομένων', icon: Database, status: 'error', message: e?.message ?? 'Αποτυχία σύνδεσης' });
    }

    // 2. Maintenance mode
    try {
      const { data } = await (supabase as any).rpc('get_platform_settings_public');
      const row = Array.isArray(data) ? data[0] : data;
      const on = !!row?.maintenance_mode;
      results.push({
        id: 'maintenance', label: 'Λειτουργία συντήρησης', icon: Wrench,
        status: on ? 'warn' : 'ok',
        message: on ? 'Ενεργή — οι χρήστες βλέπουν banner' : 'Απενεργοποιημένη',
        fix: on ? async () => {
          const { error } = await (supabase as any).from('platform_settings').update({ maintenance_mode: false }).not('id', 'is', null);
          if (error) throw error;
        } : undefined,
        fixLabel: 'Απενεργοποίηση',
      });
    } catch (e: any) {
      results.push({ id: 'maintenance', label: 'Λειτουργία συντήρησης', icon: Wrench, status: 'warn', message: e?.message ?? 'Άγνωστο' });
    }

    // 3. Mapbox token
    try {
      const { data, error } = await supabase.functions.invoke('get-mapbox-token');
      const token = (data as any)?.token;
      results.push({
        id: 'mapbox', label: 'Mapbox (χάρτες)', icon: MapPin,
        status: error || !token ? 'error' : 'ok',
        message: error ? error.message : token ? 'Token ενεργό' : 'Δεν ρυθμίστηκε MAPBOX_PUBLIC_TOKEN',
      });
    } catch (e: any) {
      results.push({ id: 'mapbox', label: 'Mapbox (χάρτες)', icon: MapPin, status: 'error', message: e?.message ?? 'Αποτυχία' });
    }

    // Helper: ping an edge function via raw fetch so validation 4xx responses don't throw.
    const pingFn = async (name: string, payload: Record<string, unknown> = { ping: true }) => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
      const t0 = performance.now();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        return {
          status: 0,
          ms: Math.round(performance.now() - t0),
          error: 'Δεν υπάρχει ενεργή σύνδεση διαχειριστή',
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      await res.text().catch(() => '');
      return { status: res.status, ms: Math.round(performance.now() - t0) };
    };

    // 4. AI Gateway via support-ai ping (any HTTP response = reachable)
    try {
      const { status, ms, error } = await pingFn('support-ai', { action: 'health_check' });
      const reachable = status > 0 && status < 500;
      results.push({
        id: 'ai', label: 'AI Gateway', icon: Sparkles,
        status: reachable ? 'ok' : 'warn',
        message: reachable ? `Απόκριση ${ms}ms` : (error ?? `HTTP ${status}`),
      });
    } catch (e: any) {
      results.push({ id: 'ai', label: 'AI Gateway', icon: Sparkles, status: 'warn', message: e?.message ?? 'Άγνωστο' });
    }

    // 5. Auto-dispatch edge function reachability (any HTTP response = reachable)
    try {
      const { status, ms, error } = await pingFn('auto-dispatch');
      const reachable = status > 0 && status < 500;
      results.push({
        id: 'dispatch', label: 'Auto-dispatch', icon: Zap,
        status: reachable ? 'ok' : 'warn',
        message: reachable ? `Διαθέσιμη (${ms}ms)` : (error ?? `HTTP ${status}`),
      });
    } catch (e: any) {
      results.push({ id: 'dispatch', label: 'Auto-dispatch', icon: Zap, status: 'warn', message: e?.message ?? 'Άγνωστο' });
    }

    // 6. Stuck orders (placed/accepted > 2h)
    try {
      const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('orders')
        .select('id')
        .in('status', ['placed', 'accepted', 'preparing'])
        .lt('created_at', cutoff);
      if (error) throw error;
      const count = data?.length ?? 0;
      results.push({
        id: 'stuck_orders', label: 'Παγωμένες παραγγελίες', icon: ShoppingBag,
        status: count === 0 ? 'ok' : count > 5 ? 'error' : 'warn',
        message: count === 0 ? 'Καμία' : `${count} παραγγελίες >2h χωρίς πρόοδο`,
        fix: count > 0 ? async () => {
          const ids = (data ?? []).map((o: any) => o.id);
          const { error: e2 } = await supabase.from('orders').update({ status: 'cancelled' as any }).in('id', ids);
          if (e2) throw e2;
        } : undefined,
        fixLabel: 'Ακύρωση όλων',
      });
    } catch (e: any) {
      results.push({ id: 'stuck_orders', label: 'Παγωμένες παραγγελίες', icon: ShoppingBag, status: 'warn', message: e?.message ?? 'Άγνωστο' });
    }

    // 7. Stale driver locations — only flag active drivers whose ping hasn't refreshed.
    try {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: active } = await supabase
        .from('driver_profiles')
        .select('user_id')
        .eq('is_active', true);
      const activeIds = (active ?? []).map((d: any) => d.user_id);
      let stale: { driver_id: string }[] = [];
      if (activeIds.length > 0) {
        const { data, error } = await supabase
          .from('driver_locations')
          .select('driver_id, updated_at')
          .in('driver_id', activeIds)
          .lt('updated_at', cutoff);
        if (error) throw error;
        stale = (data ?? []) as any;
      }
      const count = stale.length;
      results.push({
        id: 'stale_drivers', label: 'Ενεργοί οδηγοί χωρίς σήμα', icon: Bike,
        status: count === 0 ? 'ok' : 'warn',
        message: count === 0 ? 'Όλοι οι ενεργοί οδηγοί αναφέρουν θέση' : `${count} ενεργοί οδηγοί χωρίς ping >10min`,
        fix: count > 0 ? async () => {
          const ids = stale.map((d) => d.driver_id);
          // Drop their stale location rows so dispatch stops using them until they re-ping.
          const { error: e2 } = await supabase.from('driver_locations').delete().in('driver_id', ids);
          if (e2) throw e2;
        } : undefined,
        fixLabel: 'Εκκαθάριση',
      });
    } catch (e: any) {
      results.push({ id: 'stale_drivers', label: 'Ενεργοί οδηγοί χωρίς σήμα', icon: Bike, status: 'warn', message: e?.message ?? 'Άγνωστο' });
    }

    // 8. Browser connectivity
    results.push({
      id: 'network', label: 'Σύνδεση δικτύου', icon: Wifi,
      status: navigator.onLine ? 'ok' : 'error',
      message: navigator.onLine ? 'Συνδεδεμένο' : 'Δεν υπάρχει σύνδεση',
    });

    setChecks(results);
    setLastRun(new Date());
    setRunning(false);
  }, []);

  useEffect(() => { void runChecks(); }, [runChecks]);

  const runFix = async (c: CheckResult) => {
    if (!c.fix) return;
    try {
      await c.fix();
      toast.success(`${c.label}: επιδιορθώθηκε`);
      void runChecks();
    } catch (e: any) {
      toast.error(`${c.label}: ${e?.message ?? 'Απέτυχε'}`);
    }
  };

  const issues = checks.filter(c => c.status !== 'ok' && c.status !== 'checking');
  const fixable = issues.filter(c => !!c.fix);
  const overall: Status = checks.length === 0
    ? 'checking'
    : checks.some(c => c.status === 'error')
      ? 'error'
      : checks.some(c => c.status === 'warn')
        ? 'warn'
        : 'ok';

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

  return (
    <div className="space-y-3">
      <div className="admin-section-header">
        <div>
          <h2 className="admin-section-title">Κατάσταση Συστήματος</h2>
          <p className="admin-section-sub mt-0.5">
            Έλεγχος όλων των κρίσιμων υπηρεσιών της πλατφόρμας
            {lastRun && <> · τελευταίος έλεγχος {lastRun.toLocaleTimeString('el-GR')}</>}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={runChecks} disabled={running} className="h-8 gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
          Επανέλεγχος
        </Button>
      </div>

      {/* Hero status */}
      <div className={cn('admin-card p-4 flex items-center gap-4', tone[overall].bg)}>
        <div className={cn('h-12 w-12 rounded-full flex items-center justify-center bg-card shadow-sm', tone[overall].text)}>
          <Big className={cn('h-6 w-6', overall === 'checking' && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
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
            {issues.length === 0
              ? 'Καμία απαιτούμενη ενέργεια.'
              : `${issues.length} ${issues.length === 1 ? 'πρόβλημα' : 'προβλήματα'}${fixable.length ? ` · ${fixable.length} με αυτόματη επιδιόρθωση` : ''}.`}
          </p>
        </div>
        {fixable.length > 0 && (
          <Button size="sm" onClick={fixAll} disabled={fixingAll} className="gap-1.5">
            {fixingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
            Επιδιόρθωση όλων ({fixable.length})
          </Button>
        )}
      </div>

      {/* Checks list */}
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map(c => {
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
        {checks.length === 0 && running && (
          <div className="col-span-full flex items-center justify-center py-8 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Εκτέλεση ελέγχων…
          </div>
        )}
      </div>
    </div>
  );
}
