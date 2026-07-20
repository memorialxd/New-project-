import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Flag, AlertTriangle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useSettingAdvisor } from '@/hooks/useSettingAdvisor';

interface Flag {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_enabled: boolean;
  category: string;
}

const categoryColors: Record<string, string> = {
  orders: 'bg-blue-500/10 text-blue-600',
  auth: 'bg-emerald-500/10 text-emerald-600',
  finance: 'bg-violet-500/10 text-violet-600',
  support: 'bg-orange-500/10 text-orange-600',
  general: 'bg-muted text-muted-foreground',
};

export default function FeatureFlagsManager() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // maintenance
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [savingMaint, setSavingMaint] = useState(false);

  const { advise, AdvisorDialog } = useSettingAdvisor();

  const load = async () => {
    setLoading(true);
    const [f, s] = await Promise.all([
      (supabase.from as any)('feature_flags').select('*').order('category').order('label'),
      (supabase.from as any)('platform_settings').select('maintenance_mode, maintenance_message').eq('id', 1).maybeSingle(),
    ]);
    setFlags((f.data ?? []) as any);
    setMaintenanceMode(!!s.data?.maintenance_mode);
    setMaintenanceMessage(s.data?.maintenance_message ?? '');
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const applyToggle = async (flag: Flag) => {
    setBusy(flag.id);
    const { error } = await (supabase.from as any)('feature_flags')
      .update({ is_enabled: !flag.is_enabled, updated_at: new Date().toISOString() })
      .eq('id', flag.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setFlags(prev => prev.map(x => x.id === flag.id ? { ...x, is_enabled: !x.is_enabled } : x));
    await (supabase.rpc as any)('log_admin_action', {
      p_action: 'toggle_feature_flag',
      p_target_type: 'feature_flag',
      p_target_id: flag.key,
      p_description: `${!flag.is_enabled ? 'Ενεργοποίησε' : 'Απενεργοποίησε'} "${flag.label}"`,
    });
    toast.success('Αποθηκεύτηκε');
  };

  const toggle = (flag: Flag) => {
    advise(
      {
        setting_area: 'feature_flag',
        setting_label: flag.label,
        setting_key: flag.key,
        current_value: flag.is_enabled ? 'ενεργό' : 'ανενεργό',
        proposed_value: !flag.is_enabled ? 'ενεργό' : 'ανενεργό',
        context: { category: flag.category, description: flag.description },
      },
      () => applyToggle(flag),
    );
  };

  const applyMaintenance = async () => {
    setSavingMaint(true);
    const { error } = await (supabase.from as any)('platform_settings')
      .update({ maintenance_mode: maintenanceMode, maintenance_message: maintenanceMessage })
      .eq('id', 1);
    setSavingMaint(false);
    if (error) { toast.error(error.message); return; }
    await (supabase.rpc as any)('log_admin_action', {
      p_action: maintenanceMode ? 'enable_maintenance' : 'disable_maintenance',
      p_target_type: 'platform',
      p_description: maintenanceMode ? 'Ενεργοποίησε maintenance mode' : 'Απενεργοποίησε maintenance mode',
    });
    toast.success('Αποθηκεύτηκε');
  };

  const saveMaintenance = () => {
    advise(
      {
        setting_area: 'maintenance_mode',
        setting_label: 'Maintenance Mode',
        current_value: maintenanceMode ? 'θα γίνει ενεργό' : 'θα απενεργοποιηθεί',
        proposed_value: maintenanceMode ? 'ΕΝΕΡΓΟ — όλη η εφαρμογή σε συντήρηση' : 'απενεργοποιημένο',
        context: { message: maintenanceMessage },
      },
      applyMaintenance,
    );
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const grouped = flags.reduce<Record<string, Flag[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f); return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-heading font-bold text-xl flex items-center gap-2"><Flag className="h-5 w-5" />Feature Flags & Kill Switches</h2>
        <p className="text-sm text-muted-foreground mt-1">Έλεγχος όλων των δυνατοτήτων της πλατφόρμας με ένα κλικ.</p>
      </div>

      {/* Maintenance mode */}
      <Card className={maintenanceMode ? 'border-destructive/40' : ''}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${maintenanceMode ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-heading font-semibold">Maintenance Mode</h3>
                <p className="text-sm text-muted-foreground">Όταν είναι ενεργό, όλοι οι χρήστες βλέπουν banner συντήρησης.</p>
              </div>
            </div>
            <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
          </div>
          <Textarea
            placeholder="Μήνυμα προς τους χρήστες (π.χ. «Κάνουμε αναβάθμιση, επιστρέφουμε σε 30 λεπτά»)"
            value={maintenanceMessage}
            onChange={e => setMaintenanceMessage(e.target.value)}
            rows={2}
          />
          <Button size="sm" onClick={saveMaintenance} disabled={savingMaint} className="gap-2">
            {savingMaint ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Αποθήκευση
          </Button>
        </CardContent>
      </Card>

      {/* Flags by category */}
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Badge variant="outline" className={categoryColors[cat] ?? categoryColors.general}>{cat}</Badge>
            <span className="text-xs text-muted-foreground">{items.length} flags</span>
          </div>
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {items.map(flag => (
                <div key={flag.id} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{flag.label}</p>
                      {!flag.is_enabled && <Badge variant="destructive" className="h-5 text-[10px]">OFF</Badge>}
                    </div>
                    {flag.description && <p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>}
                    <code className="text-[10px] text-muted-foreground/60 font-mono">{flag.key}</code>
                  </div>
                  <div className="flex items-center">
                    {busy === flag.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-3" /> : null}
                    <Switch checked={flag.is_enabled} onCheckedChange={() => toggle(flag)} disabled={busy === flag.id} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ))}
      {AdvisorDialog}
    </div>
  );
}
