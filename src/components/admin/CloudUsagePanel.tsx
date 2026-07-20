import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Cloud, Database, Zap, Image as ImageIcon, HardDrive, RefreshCw, ExternalLink, AlertTriangle, Trash2, Settings, Activity, Sparkles, ShieldAlert, Power, Bell, MapPin, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useGuardrails, saveGuardrails, getAiCallsToday, resetAiCounter, effective, useUsageMeter, resetUsageMeter, isBudgetExceeded, isSoftThrottled } from '@/lib/cost-guardrails';
import { Progress } from '@/components/ui/progress';

type TableStat = { table: string; label: string; count: number | null; hint?: string };

const TRACKED_TABLES: { table: string; label: string; hint?: string }[] = [
  { table: 'orders', label: 'Παραγγελίες' },
  { table: 'order_items', label: 'Items παραγγελιών' },
  { table: 'transactions', label: 'Συναλλαγές' },
  { table: 'driver_locations', label: 'Driver locations', hint: 'Υψηλός όγκος — καθάρισε παλιά' },
  { table: 'admin_audit_log', label: 'Audit log' },
  { table: 'driver_notifications', label: 'Ειδοποιήσεις οδηγών' },
  { table: 'pending_offers', label: 'Pending offers' },
  { table: 'email_send_log', label: 'Email log' },
  { table: 'fraud_signals', label: 'Fraud signals' },
  { table: 'profiles', label: 'Χρήστες' },
];

const STORAGE_KEY = 'cloud_usage_settings_v1';

type LocalSettings = {
  autoCleanup: boolean;
  retainLocationsDays: number;
  retainAuditDays: number;
  retainNotificationsDays: number;
  retainEmailLogDays: number;
  aiBudgetEur: number;
};

const DEFAULT_SETTINGS: LocalSettings = {
  autoCleanup: false,
  retainLocationsDays: 7,
  retainAuditDays: 90,
  retainNotificationsDays: 30,
  retainEmailLogDays: 60,
  aiBudgetEur: 25,
};

function loadSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

export default function CloudUsagePanel() {
  const [stats, setStats] = useState<TableStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<LocalSettings>(loadSettings);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const guardrails = useGuardrails();
  const eff = effective(guardrails);
  const aiUsedToday = getAiCallsToday();

  const totalRows = stats.reduce((a, s) => a + (s.count ?? 0), 0);

  const refresh = async () => {
    setLoading(true);
    const results: TableStat[] = await Promise.all(
      TRACKED_TABLES.map(async (t) => {
        const { count, error } = await supabase
          .from(t.table as any)
          .select('*', { count: 'exact', head: true });
        return {
          table: t.table,
          label: t.label,
          hint: t.hint,
          count: error ? null : count ?? 0,
        };
      })
    );
    setStats(results.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const saveSettings = (next: Partial<LocalSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    toast.success('Αποθηκεύτηκε');
  };

  const cleanupOldRows = async (
    table: 'driver_locations' | 'admin_audit_log' | 'driver_notifications' | 'email_send_log',
    days: number,
    column: string = 'created_at'
  ) => {
    if (!confirm(`Να διαγραφούν εγγραφές παλαιότερες από ${days} ημέρες από το ${table};`)) return;
    setCleaning(table);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const { error, count } = await supabase
      .from(table as any)
      .delete({ count: 'exact' })
      .lt(column, cutoff);
    setCleaning(null);
    if (error) {
      toast.error(`Αποτυχία: ${error.message}`);
    } else {
      toast.success(`Διαγράφηκαν ${count ?? 0} εγγραφές`);
      refresh();
    }
  };

  const fmtCount = (n: number | null) =>
    n === null ? '—' : n.toLocaleString('el-GR');

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            Lovable Cloud — Χρήση & Έλεγχος
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Παρακολούθηση χρήσης backend, AI και storage. Καθαρισμός & ρυθμίσεις διατήρησης.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Ανανέωση
        </Button>
      </div>
      {/* DAILY BUDGET METER — self-throttling */}
      <BudgetCard />

      {/* PANIC MODE + guardrails */}
      <Card className={guardrails.panicMode ? 'border-destructive bg-destructive/5' : 'border-warning/40'}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldAlert className={`h-5 w-5 ${guardrails.panicMode ? 'text-destructive' : 'text-warning'}`} />
            Cost Guardrails — Όρια & Kill Switches
          </CardTitle>
          <CardDescription>
            Σκληρά όρια για να μην χρεωθείς τρελά ποσά. Ενεργοποιείται άμεσα παντού στην εφαρμογή.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Panic mode */}
          <div className={`flex items-center justify-between p-3 rounded-lg border ${guardrails.panicMode ? 'border-destructive bg-destructive/10' : 'border-border'}`}>
            <div className="flex items-start gap-3">
              <Power className={`h-5 w-5 mt-0.5 ${guardrails.panicMode ? 'text-destructive' : 'text-muted-foreground'}`} />
              <div>
                <Label className="font-semibold">Panic Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Απενεργοποιεί ΑΜΕΣΑ: AI, push notifications, realtime locations, uploads.
                </p>
              </div>
            </div>
            <Switch
              checked={guardrails.panicMode}
              onCheckedChange={(v) => { saveGuardrails({ panicMode: v }); toast.success(v ? 'Panic mode ON' : 'Panic mode OFF'); }}
            />
          </div>

          {/* Kill switches grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            <KillSwitch
              icon={<Sparkles className="h-4 w-4" />}
              label="Lovable AI"
              hint={`Σήμερα: ${aiUsedToday} / ${guardrails.aiDailyCallCap} κλήσεις`}
              checked={eff.aiEnabled}
              disabled={guardrails.panicMode}
              onChange={(v) => saveGuardrails({ aiEnabled: v })}
            />
            <KillSwitch
              icon={<MapPin className="h-4 w-4" />}
              label="Realtime Driver Locations"
              hint={`Update κάθε ${guardrails.driverLocationIntervalSec}s`}
              checked={eff.realtimeLocationsEnabled}
              disabled={guardrails.panicMode}
              onChange={(v) => saveGuardrails({ realtimeLocationsEnabled: v })}
            />
            <KillSwitch
              icon={<Bell className="h-4 w-4" />}
              label="Push Notifications"
              hint="OneSignal / OS ειδοποιήσεις"
              checked={eff.pushNotificationsEnabled}
              disabled={guardrails.panicMode}
              onChange={(v) => saveGuardrails({ pushNotificationsEnabled: v })}
            />
            <KillSwitch
              icon={<Upload className="h-4 w-4" />}
              label="Storage Uploads"
              hint={`Μέγιστο ${guardrails.maxUploadMb} MB / αρχείο`}
              checked={eff.storageUploadsEnabled}
              disabled={guardrails.panicMode}
              onChange={(v) => saveGuardrails({ storageUploadsEnabled: v })}
            />
          </div>

          <Separator />

          {/* Hard caps */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">AI όριο/ημέρα (κλήσεις)</Label>
              <div className="flex gap-2">
                <Input
                  type="number" min={1}
                  value={guardrails.aiDailyCallCap}
                  onChange={(e) => saveGuardrails({ aiDailyCallCap: Number(e.target.value) || 1 })}
                />
                <Button size="sm" variant="outline" onClick={() => { resetAiCounter(); toast.success('Reset'); }}>
                  Reset
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Driver location interval (sec)</Label>
              <Input
                type="number" min={5}
                value={guardrails.driverLocationIntervalSec}
                onChange={(e) => saveGuardrails({ driverLocationIntervalSec: Math.max(5, Number(e.target.value) || 15) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Μέγιστο upload (MB)</Label>
              <Input
                type="number" min={1} max={50}
                value={guardrails.maxUploadMb}
                onChange={(e) => saveGuardrails({ maxUploadMb: Number(e.target.value) || 5 })}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <Label className="text-sm font-medium">Φθηνό AI model (flash-lite)</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Εξοικονομεί έως 90% credits</p>
              </div>
              <Switch
                checked={guardrails.aiPreferCheapModel}
                onCheckedChange={(v) => saveGuardrails({ aiPreferCheapModel: v })}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border sm:col-span-2">
              <div>
                <Label className="text-sm font-medium">Συμπίεση εικόνων πριν το upload</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Μειώνει σημαντικά το κόστος storage & bandwidth</p>
              </div>
              <Switch
                checked={guardrails.imageCompression}
                onCheckedChange={(v) => saveGuardrails({ imageCompression: v })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* High-level cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Σύνολο εγγραφών DB</p>
                <p className="text-2xl font-bold mt-1">{totalRows.toLocaleString('el-GR')}</p>
              </div>
              <Database className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Tables με δεδομένα</p>
                <p className="text-2xl font-bold mt-1">{stats.filter(s => (s.count ?? 0) > 0).length}/{TRACKED_TABLES.length}</p>
              </div>
              <HardDrive className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">AI Budget / μήνα</p>
                <p className="text-2xl font-bold mt-1">€{settings.aiBudgetEur}</p>
              </div>
              <Sparkles className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Free Cloud / μήνα</p>
                <p className="text-2xl font-bold mt-1">$25</p>
              </div>
              <Zap className="h-8 w-8 text-primary/40" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live billing link */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Activity className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Live χρέωση & quota</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Real-time κόστος, AI gateway usage και instance size διαχειρίζονται από το Backend dashboard.
              </p>
            </div>
          </div>
          <Button asChild variant="default" size="sm">
            <a href="#" onClick={(e) => { e.preventDefault(); (window as any).dispatchEvent(new CustomEvent('lovable:open-backend')); }}>
              Άνοιγμα Backend <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Per-table stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database — όγκος ανά πίνακα
          </CardTitle>
          <CardDescription>
            Οι μεγαλύτεροι πίνακες επηρεάζουν περισσότερο το κόστος αποθήκευσης. Καθάρισε τακτικά.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stats.map((s) => {
              const isHeavy = (s.count ?? 0) > 5000;
              return (
                <div
                  key={s.table}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.label}</span>
                      {isHeavy && (
                        <Badge variant="outline" className="text-[10px] h-5 border-warning/40 text-warning">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Μεγάλος
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {s.table}{s.hint && ` · ${s.hint}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums text-sm">{fmtCount(s.count)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">rows</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Retention settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Πολιτική διατήρησης (retention)
          </CardTitle>
          <CardDescription>
            Πόσες ημέρες κρατάμε ιστορικά δεδομένα πριν τη διαγραφή.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div>
              <Label className="font-semibold">Αυτόματος καθαρισμός</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Τρέχει καθημερινά καθαρισμό βάσει των ημερών παρακάτω (απαιτεί cron job).
              </p>
            </div>
            <Switch
              checked={settings.autoCleanup}
              onCheckedChange={(v) => saveSettings({ autoCleanup: v })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <RetentionRow
              label="Driver locations"
              value={settings.retainLocationsDays}
              onChange={(v) => saveSettings({ retainLocationsDays: v })}
              onClean={() => cleanupOldRows('driver_locations', settings.retainLocationsDays, 'updated_at')}
              cleaning={cleaning === 'driver_locations'}
            />
            <RetentionRow
              label="Audit log"
              value={settings.retainAuditDays}
              onChange={(v) => saveSettings({ retainAuditDays: v })}
              onClean={() => cleanupOldRows('admin_audit_log', settings.retainAuditDays)}
              cleaning={cleaning === 'admin_audit_log'}
            />
            <RetentionRow
              label="Ειδοποιήσεις οδηγών"
              value={settings.retainNotificationsDays}
              onChange={(v) => saveSettings({ retainNotificationsDays: v })}
              onClean={() => cleanupOldRows('driver_notifications', settings.retainNotificationsDays)}
              cleaning={cleaning === 'driver_notifications'}
            />
            <RetentionRow
              label="Email log"
              value={settings.retainEmailLogDays}
              onChange={(v) => saveSettings({ retainEmailLogDays: v })}
              onClean={() => cleanupOldRows('email_send_log', settings.retainEmailLogDays)}
              cleaning={cleaning === 'email_send_log'}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="font-semibold">Μηνιαίο όριο AI (€)</Label>
            <p className="text-xs text-muted-foreground">
              Soft limit για το Lovable AI gateway. Πάνω από αυτό, στείλε alert.
            </p>
            <div className="flex gap-2 max-w-xs">
              <Input
                type="number"
                min={1}
                value={settings.aiBudgetEur}
                onChange={(e) => setSettings({ ...settings, aiBudgetEur: Number(e.target.value) })}
              />
              <Button size="sm" onClick={() => saveSettings({ aiBudgetEur: settings.aiBudgetEur })}>
                Αποθήκευση
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card className="border-info/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-info" />
            Συμβουλές μείωσης κόστους
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>• Καθάρισε <strong>driver_locations</strong> κάθε εβδομάδα — μεγαλώνει γρήγορα.</p>
          <p>• Χρησιμοποίησε <strong>image compression</strong> πριν το upload σε storage buckets.</p>
          <p>• Αν το app είναι αργό, αναβάθμισε το <strong>instance size</strong> αντί να προσθέτεις indexes παντού.</p>
          <p>• Realtime subscriptions χρεώνονται ανά μήνυμα — απενεργοποίησε όσα δεν χρησιμοποιούνται.</p>
          <p>• Το AI gateway είναι δωρεάν μέχρι $1/μήνα — μετά usage-based. Cache responses όπου γίνεται.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function RetentionRow({
  label, value, onChange, onClean, cleaning,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onClean: () => void;
  cleaning: boolean;
}) {
  return (
    <div className="p-3 rounded-lg border border-border space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20"
        />
        <span className="text-xs text-muted-foreground">ημέρες</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={onClean}
          disabled={cleaning}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          {cleaning ? 'Καθαρίζει…' : 'Καθάρισε τώρα'}
        </Button>
      </div>
    </div>
  );
}

function KillSwitch({
  icon, label, hint, checked, disabled, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${checked ? 'border-border' : 'border-destructive/40 bg-destructive/5'}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <div className={`mt-0.5 ${checked ? 'text-primary' : 'text-destructive'}`}>{icon}</div>
        <div className="min-w-0">
          <Label className="text-sm font-medium block">{label}</Label>
          {hint && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function BudgetCard() {
  const g = useGuardrails();
  const meter = useUsageMeter();
  const cap = Math.max(g.dailyBudgetCredits, 0.0001);
  const pct = Math.min(100, (meter.total / cap) * 100);
  const tripped = isBudgetExceeded(g);
  const soft = isSoftThrottled(g);
  const state: 'ok' | 'warn' | 'over' = tripped ? 'over' : soft ? 'warn' : 'ok';
  const tone =
    state === 'over' ? 'border-destructive bg-destructive/5'
    : state === 'warn' ? 'border-warning/40 bg-warning/5'
    : 'border-border';

  const bucketRow = (label: string, value: number) => (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value.toFixed(4)}</span>
    </div>
  );

  return (
    <Card className={tone}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Ημερήσιο Budget — Self-throttling
        </CardTitle>
        <CardDescription>
          Ζωντανό μετρητή κόστους ανά UTC ημέρα. Στο {g.softThrottlePct}% μπαίνει soft-throttle (κλείνει AI + realtime).
          Στο 100% {g.autoPanicOnBudget ? 'ενεργοποιείται αυτόματα το Panic Mode' : 'εμφανίζει προειδοποίηση'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Χρήση σήμερα</span>
            <span className="font-semibold tabular-nums">
              {meter.total.toFixed(3)} / {g.dailyBudgetCredits} credits ({pct.toFixed(0)}%)
            </span>
          </div>
          <Progress value={pct} className={state === 'over' ? '[&>div]:bg-destructive' : state === 'warn' ? '[&>div]:bg-warning' : ''} />
          {state === 'over' && (
            <p className="text-xs text-destructive font-medium">
              ⛔ Ξεπέρασες το budget — μη-βασικές υπηρεσίες έχουν κλείσει αυτόματα.
            </p>
          )}
          {state === 'warn' && (
            <p className="text-xs text-warning-foreground">
              ⚠️ Soft-throttle ενεργό — AI & realtime locations παύουν προσωρινά.
            </p>
          )}
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {bucketRow('AI calls', meter.buckets.ai)}
          {bucketRow('DB writes', meter.buckets.db)}
          {bucketRow('Realtime', meter.buckets.realtime)}
          {bucketRow('Storage', meter.buckets.storage)}
        </div>

        <Separator />

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Daily cap (credits)</Label>
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={g.dailyBudgetCredits}
              onChange={(e) => saveGuardrails({ dailyBudgetCredits: Number(e.target.value) || 1 })}
            />
          </div>
          <div>
            <Label className="text-xs">Soft-throttle %</Label>
            <Input
              type="number"
              min={10}
              max={99}
              value={g.softThrottlePct}
              onChange={(e) => saveGuardrails({ softThrottlePct: Math.min(99, Math.max(10, Number(e.target.value) || 75)) })}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" className="w-full" onClick={() => { resetUsageMeter(); toast.success('Μετρητής μηδενίστηκε'); }}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reset μετρητή
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <div className="min-w-0">
            <Label className="text-sm font-medium block">Auto-panic στο 100%</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">Κλείνει αυτόματα όλες τις πληρωμένες υπηρεσίες όταν εξαντληθεί το budget.</p>
          </div>
          <Switch checked={g.autoPanicOnBudget} onCheckedChange={(v) => saveGuardrails({ autoPanicOnBudget: v })} />
        </div>
      </CardContent>
    </Card>
  );
}

