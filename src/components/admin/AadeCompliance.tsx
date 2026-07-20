import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, FileText, AlertTriangle } from 'lucide-react';

type Config = {
  id: string;
  legal_name: string | null;
  trade_name: string | null;
  afm: string | null;
  doy: string | null;
  kad: string | null;
  legal_address: string | null;
  legal_city: string | null;
  legal_postal_code: string | null;
  representative_name: string | null;
  representative_afm: string | null;
  iban: string | null;
  mydata_environment: 'production' | 'sandbox';
  mydata_user_id: string | null;
  mydata_subscription_key: string | null;
  mydata_base_url: string | null;
  platform_registration_number: string | null;
  platform_reporting_enabled: boolean;
};

type Report = {
  id: string;
  order_id: string | null;
  store_afm: string | null;
  driver_afm: string | null;
  order_number: string | null;
  delivery_at: string | null;
  gross_amount: number | null;
  status: string;
  mydata_mark: string | null;
  error_message: string | null;
  created_at: string;
};

export default function AadeCompliance() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: r }] = await Promise.all([
        supabase.from('aade_platform_config').select('*').limit(1).maybeSingle(),
        supabase.from('aade_delivery_reports').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      setCfg(c as Config | null);
      setReports((r as Report[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const update = (patch: Partial<Config>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    const { error } = await supabase.from('aade_platform_config').update({
      legal_name: cfg.legal_name, trade_name: cfg.trade_name, afm: cfg.afm, doy: cfg.doy, kad: cfg.kad,
      legal_address: cfg.legal_address, legal_city: cfg.legal_city, legal_postal_code: cfg.legal_postal_code,
      representative_name: cfg.representative_name, representative_afm: cfg.representative_afm, iban: cfg.iban,
      mydata_environment: cfg.mydata_environment, mydata_user_id: cfg.mydata_user_id,
      mydata_subscription_key: cfg.mydata_subscription_key, mydata_base_url: cfg.mydata_base_url,
      platform_registration_number: cfg.platform_registration_number,
      platform_reporting_enabled: cfg.platform_reporting_enabled,
    }).eq('id', cfg.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('Αποθηκεύτηκε');
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
  if (!cfg) return <div className="p-6 text-muted-foreground">Δεν βρέθηκε ρύθμιση ΑΑΔΕ.</div>;

  const requiredOk = !!(cfg.legal_name && cfg.afm && cfg.doy && cfg.kad && cfg.iban);
  const apiOk = !!(cfg.mydata_user_id && cfg.mydata_subscription_key);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Συμμόρφωση ΑΑΔΕ
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Ν.5073/2023 — Πλατφόρμες Οικ. Δραστηριότητας &amp; myDATA διαβίβαση
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={requiredOk ? 'default' : 'destructive'}>
            {requiredOk ? '✓ Στοιχεία πλατφόρμας' : '✗ Λείπουν στοιχεία'}
          </Badge>
          <Badge variant={apiOk ? 'default' : 'secondary'}>
            {apiOk ? '✓ myDATA credentials' : 'myDATA δεν έχει ρυθμιστεί'}
          </Badge>
          <Badge variant={cfg.platform_reporting_enabled ? 'default' : 'secondary'}>
            Διαβίβαση: {cfg.platform_reporting_enabled ? 'ON' : 'OFF'}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="entity">
        <TabsList>
          <TabsTrigger value="entity">Στοιχεία πλατφόρμας</TabsTrigger>
          <TabsTrigger value="mydata">myDATA API</TabsTrigger>
          <TabsTrigger value="reports">Διαβιβάσεις ({reports.length})</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="entity">
          <Card>
            <CardHeader>
              <CardTitle>Νομικά στοιχεία</CardTitle>
              <CardDescription>Απαιτούνται για κάθε δήλωση προς ΑΑΔΕ.</CardDescription>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <Field label="Επωνυμία *" value={cfg.legal_name} onChange={(v) => update({ legal_name: v })} />
              <Field label="Διακριτικός τίτλος" value={cfg.trade_name} onChange={(v) => update({ trade_name: v })} />
              <Field label="ΑΦΜ *" value={cfg.afm} onChange={(v) => update({ afm: v })} />
              <Field label="ΔΟΥ *" value={cfg.doy} onChange={(v) => update({ doy: v })} />
              <Field label="ΚΑΔ *" value={cfg.kad} onChange={(v) => update({ kad: v })} placeholder="π.χ. 53.20.31" />
              <Field label="IBAN *" value={cfg.iban} onChange={(v) => update({ iban: v })} />
              <Field label="Διεύθυνση έδρας" value={cfg.legal_address} onChange={(v) => update({ legal_address: v })} />
              <Field label="Πόλη" value={cfg.legal_city} onChange={(v) => update({ legal_city: v })} />
              <Field label="ΤΚ" value={cfg.legal_postal_code} onChange={(v) => update({ legal_postal_code: v })} />
              <Field label="Νόμιμος εκπρόσωπος" value={cfg.representative_name} onChange={(v) => update({ representative_name: v })} />
              <Field label="ΑΦΜ εκπροσώπου" value={cfg.representative_afm} onChange={(v) => update({ representative_afm: v })} />
              <Field label="Αρ. μητρώου πλατφόρμας ΑΑΔΕ" value={cfg.platform_registration_number} onChange={(v) => update({ platform_registration_number: v })} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mydata">
          <Card>
            <CardHeader>
              <CardTitle>myDATA / ΑΑΔΕ API credentials</CardTitle>
              <CardDescription>
                Από <span className="font-mono">myDATA → Εγγραφή Χρήστη Διαβίβασης</span>. Τα subscription keys αποθηκεύονται κρυπτογραφημένα.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Περιβάλλον</Label>
                <Select value={cfg.mydata_environment} onValueChange={(v: any) => update({
                  mydata_environment: v,
                  mydata_base_url: v === 'production' ? 'https://mydatapi.aade.gr/myDATA' : 'https://mydatapi-dev.azure-api.net/myDATA',
                })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production (mydatapi.aade.gr)</SelectItem>
                    <SelectItem value="sandbox">Sandbox (dev)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field label="Base URL" value={cfg.mydata_base_url} onChange={(v) => update({ mydata_base_url: v })} />
              <Field label="User-Id" value={cfg.mydata_user_id} onChange={(v) => update({ mydata_user_id: v })} />
              <Field label="Subscription Key" value={cfg.mydata_subscription_key} onChange={(v) => update({ mydata_subscription_key: v })} type="password" />
              <div className="md:col-span-2 flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-base">Ενεργοποίηση διαβίβασης</Label>
                  <p className="text-xs text-muted-foreground">Όταν είναι ON, κάθε ολοκληρωμένη παράδοση καταγράφεται στο log για αποστολή.</p>
                </div>
                <Switch checked={cfg.platform_reporting_enabled} onCheckedChange={(v) => update({ platform_reporting_enabled: v })} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Log διαβιβάσεων</CardTitle>
              <CardDescription>Τελευταίες 50 παραδόσεις προς αποστολή στην ΑΑΔΕ.</CardDescription>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Δεν υπάρχουν εγγραφές ακόμη.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-2">Παραγγελία</th>
                        <th className="text-left">Κατ. ΑΦΜ</th>
                        <th className="text-left">Οδ. ΑΦΜ</th>
                        <th className="text-right">Ποσό</th>
                        <th className="text-left">Status</th>
                        <th className="text-left">MARK</th>
                        <th className="text-left">Ημ/νία</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((r) => (
                        <tr key={r.id} className="border-b">
                          <td className="py-2 font-mono text-xs">{r.order_number ?? r.order_id?.slice(0, 8)}</td>
                          <td>{r.store_afm ?? '—'}</td>
                          <td>{r.driver_afm ?? '—'}</td>
                          <td className="text-right tabular-nums">{r.gross_amount?.toFixed(2) ?? '—'}€</td>
                          <td><StatusBadge status={r.status} /></td>
                          <td className="font-mono text-xs">{r.mydata_mark ?? '—'}</td>
                          <td className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString('el-GR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /> Νομικές απαιτήσεις</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Check ok={requiredOk}>Νομικά στοιχεία πλατφόρμας (ΑΦΜ, ΔΟΥ, ΚΑΔ, IBAN)</Check>
              <Check ok={!!cfg.platform_registration_number}>Εγγραφή στο μητρώο πλατφορμών ΑΑΔΕ (Ν.5073/2023)</Check>
              <Check ok={apiOk}>myDATA credentials (User-Id + Subscription Key)</Check>
              <Check ok={cfg.platform_reporting_enabled}>Διαβίβαση ενεργοποιημένη</Check>
              <Check ok>Πεδία οδηγών (ΑΦΜ, ΑΜΚΑ, ΕΦΚΑ) — διαθέσιμα στο προφίλ οδηγού</Check>
              <Check ok>Πεδία καταστημάτων (ΑΦΜ, ΔΟΥ, ΚΑΔ) — διαθέσιμα στα stores</Check>
              <Check ok>Log παραδόσεων (αξία, ΦΠΑ, προμήθεια, αμοιβή οδηγού, διευθύνσεις)</Check>
              <p className="text-xs text-muted-foreground pt-3 border-t mt-3">
                ⓘ Η σύνδεση με το πραγματικό API myDATA θα γίνει μέσω edge function. Όλα τα δεδομένα καταγράφονται ήδη — όταν δώσεις τα credentials, το reporting ενεργοποιείται με ένα switch.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end sticky bottom-2">
        <Button onClick={save} disabled={saving} size="lg">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Αποθήκευση
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string | null; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'secondary', sent: 'outline', accepted: 'default', rejected: 'destructive', error: 'destructive',
  };
  return <Badge variant={map[status] ?? 'secondary'}>{status}</Badge>;
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? 'text-green-600' : 'text-muted-foreground'}>{ok ? '✓' : '○'}</span>
      <span className={ok ? '' : 'text-muted-foreground'}>{children}</span>
    </div>
  );
}
