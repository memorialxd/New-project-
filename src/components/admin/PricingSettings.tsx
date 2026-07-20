import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DollarSign, Save, Loader2, MapPin, Shield, Flame, Bike, Car, Percent, Activity, AlertTriangle } from 'lucide-react';
import StorePricingOverrides from './StorePricingOverrides';
import CommissionTiersPanel from './CommissionTiersPanel';

interface PricingRow {
  base_pay: number;
  first_km_price: number;
  per_km_rate: number;
  min_pay: number;
  max_pay: number;
  customer_base_fee: number;
  customer_per_km_fee: number;
  platform_service_fee: number;
  peak_multiplier: number;
  peak_start_hour: number;
  peak_end_hour: number;
  peak_weekdays: number[];
  bike_multiplier: number;
  motorcycle_multiplier: number;
  car_multiplier: number;
  default_commission_pct: number;
  admin_share_pct: number;
  driver_pool_pct_of_subtotal: number;
  pool_healthy_threshold: number;
  low_pool_threshold: number;
  pool_critical_threshold: number;
  pool_low_multiplier: number;
  pool_critical_multiplier: number;
  subsidize_min_pay: boolean;
  pool_alert_enabled: boolean;
  pause_bonus_when_critical: boolean;
}

const DAYS = [
  { n: 1, label: 'Δευ' }, { n: 2, label: 'Τρι' }, { n: 3, label: 'Τετ' },
  { n: 4, label: 'Πεμ' }, { n: 5, label: 'Παρ' }, { n: 6, label: 'Σαβ' }, { n: 7, label: 'Κυρ' },
];

export default function PricingSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pricing, setPricing] = useState<PricingRow>({
    base_pay: 3, first_km_price: 3, per_km_rate: 0.5, min_pay: 3, max_pay: 12,
    customer_base_fee: 1.5, customer_per_km_fee: 0.8,
    platform_service_fee: 0.99,
    peak_multiplier: 1.0, peak_start_hour: 19, peak_end_hour: 22,
    peak_weekdays: [1, 2, 3, 4, 5, 6, 7],
    bike_multiplier: 1.0, motorcycle_multiplier: 1.0, car_multiplier: 1.0,
    default_commission_pct: 15, admin_share_pct: 5, driver_pool_pct_of_subtotal: 10,
    pool_healthy_threshold: 500, low_pool_threshold: 50, pool_critical_threshold: 20,
    pool_low_multiplier: 0.85, pool_critical_multiplier: 0.6,
    subsidize_min_pay: false, pool_alert_enabled: true, pause_bonus_when_critical: false,
  });
  const [poolBalance, setPoolBalance] = useState<number>(0);

  useEffect(() => {
    supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data) {
          const d = data as any;
          setPricing({
            base_pay: Number(d.base_pay ?? 3),
            first_km_price: Number(d.first_km_price ?? d.base_pay ?? 3),
            per_km_rate: Number(d.per_km_rate ?? 0.5),
            min_pay: Number(d.min_pay ?? 3),
            max_pay: Number(d.max_pay ?? 12),
            customer_base_fee: Number(d.customer_base_fee ?? 1.5),
            customer_per_km_fee: Number(d.customer_per_km_fee ?? 0.8),
            platform_service_fee: Number(d.platform_service_fee ?? 0.99),
            peak_multiplier: Number(d.peak_multiplier ?? 1),
            peak_start_hour: Number(d.peak_start_hour ?? 19),
            peak_end_hour: Number(d.peak_end_hour ?? 22),
            peak_weekdays: (d.peak_weekdays ?? [1,2,3,4,5,6,7]) as number[],
            bike_multiplier: Number(d.bike_multiplier ?? 1),
            motorcycle_multiplier: Number(d.motorcycle_multiplier ?? 1),
            car_multiplier: Number(d.car_multiplier ?? 1),
            default_commission_pct: Math.max(15, Number(d.default_commission_pct ?? 15)),
            admin_share_pct: Math.max(5, Number(d.admin_share_pct ?? 5)),
            driver_pool_pct_of_subtotal: Math.max(10, Number(d.driver_pool_pct_of_subtotal ?? 10)),
            pool_healthy_threshold: Number(d.pool_healthy_threshold ?? 500),
            low_pool_threshold: Number(d.low_pool_threshold ?? 50),
            pool_critical_threshold: Number(d.pool_critical_threshold ?? 20),
            pool_low_multiplier: Number(d.pool_low_multiplier ?? 0.85),
            pool_critical_multiplier: Number(d.pool_critical_multiplier ?? 0.6),
            subsidize_min_pay: !!d.subsidize_min_pay,
            pool_alert_enabled: d.pool_alert_enabled !== false,
            pause_bonus_when_critical: !!d.pause_bonus_when_critical,
          });
        }
        setLoading(false);
      });
    (supabase as any).from('admin_treasury').select('platform_pool').eq('id', 1).maybeSingle()
      .then(({ data }: any) => { if (data) setPoolBalance(Number(data.platform_pool ?? 0)); });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ id: 1, ...pricing } as any, { onConflict: 'id' });
    setSaving(false);
    if (error) toast.error('Αποτυχία αποθήκευσης');
    else toast.success('Οι τιμές ενημερώθηκαν');
  };

  const toggleDay = (n: number) => {
    setPricing(p => ({
      ...p,
      peak_weekdays: p.peak_weekdays.includes(n)
        ? p.peak_weekdays.filter(x => x !== n)
        : [...p.peak_weekdays, n].sort(),
    }));
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const previewKm = 3;
  const extraKm = Math.max(0, previewKm - 1);
  const driverDeliveryPay = Math.min(pricing.max_pay, Math.max(pricing.min_pay, pricing.first_km_price + pricing.per_km_rate * extraKm));
  const customerFee = pricing.customer_base_fee + pricing.customer_per_km_fee * previewKm;

  // Live preview of pool-health bonus formula
  const rawBonus = pricing.first_km_price + pricing.per_km_rate * extraKm;
  const clampedBonus = Math.min(Math.max(rawBonus, pricing.min_pay), pricing.max_pay);
  let healthLabel: 'υγιές'|'κανονικό'|'χαμηλό'|'κρίσιμο' = 'κανονικό';
  let mult = 1.0;
  if (poolBalance >= pricing.pool_healthy_threshold) { healthLabel = 'υγιές'; mult = 1; }
  else if (poolBalance >= pricing.low_pool_threshold) { healthLabel = 'κανονικό'; mult = 1; }
  else if (poolBalance >= pricing.pool_critical_threshold) { healthLabel = 'χαμηλό'; mult = pricing.pool_low_multiplier; }
  else { healthLabel = 'κρίσιμο'; mult = pricing.pool_critical_multiplier; }
  let finalBonus = Math.max(clampedBonus * mult, pricing.min_pay);
  const isPaused = healthLabel === 'κρίσιμο' && pricing.pause_bonus_when_critical;
  if (isPaused) finalBonus = pricing.subsidize_min_pay ? pricing.min_pay : 0;

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="font-heading font-bold text-xl">Τιμολόγηση Πλατφόρμας</h2>
        <p className="text-sm text-muted-foreground mt-1">Πλήρης έλεγχος αμοιβών οδηγών, χρεώσεων πελατών και προμηθειών.</p>
      </div>

      <Tabs defaultValue="driver">
        <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full">
          <TabsTrigger value="driver">Οδηγός</TabsTrigger>
          <TabsTrigger value="customer">Πελάτης</TabsTrigger>
          <TabsTrigger value="peak">Peak</TabsTrigger>
          <TabsTrigger value="vehicle">Όχημα</TabsTrigger>
          <TabsTrigger value="tiers">Tiers</TabsTrigger>
          <TabsTrigger value="stores">Καταστήματα</TabsTrigger>
        </TabsList>

        <TabsContent value="driver" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="font-heading text-base flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" />Αμοιβή Οδηγού (delivery fee)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <Field label="Τιμή 1ου χλμ (€)" value={pricing.first_km_price} onChange={v => setPricing(p => ({ ...p, first_km_price: v }))} hint="Flat για το πρώτο χλμ" />
                <Field label="€ / χλμ μετά" value={pricing.per_km_rate} onChange={v => setPricing(p => ({ ...p, per_km_rate: v }))} hint="Για κάθε χλμ μετά το 1ο" icon={MapPin} />
                <Field label="Ελάχιστη Αμοιβή (€)" value={pricing.min_pay} onChange={v => setPricing(p => ({ ...p, min_pay: v }))} hint="Εγγυημένο ελάχιστο" icon={Shield} />
                <Field label="Μέγιστη Αμοιβή (€)" value={pricing.max_pay} onChange={v => setPricing(p => ({ ...p, max_pay: v }))} hint="Cap ανά παράδοση" />
              </div>
              <Preview label={`Delivery fee — ${previewKm} χλμ`} amount={driverDeliveryPay} note={`€${pricing.first_km_price.toFixed(2)} + ${extraKm} × €${pricing.per_km_rate.toFixed(2)}`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Bonus από Driver Pool — Self-Balancing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                Πέρα από το delivery fee, κάθε ολοκληρωμένη παράδοση πληρώνει στον οδηγό ένα <b>bonus</b> από το 10% Driver Pool.
                Ο τύπος είναι <code>(base + per_km × χλμ)</code>, clamped σε [min, max], πολλαπλασιασμένο επί τον <b>pool-health multiplier</b>.
                Όταν το pool αδυνατίζει, τα bonus μειώνονται αυτόματα — ποτέ όμως κάτω από το <b>Ελάχιστη Αμοιβή</b> που ορίζεις.
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Healthy threshold (€)" value={pricing.pool_healthy_threshold} onChange={v => setPricing(p => ({ ...p, pool_healthy_threshold: v }))} hint="Πάνω από αυτό = full payout" />
                <Field label="Low threshold (€)" value={pricing.low_pool_threshold} onChange={v => setPricing(p => ({ ...p, low_pool_threshold: v }))} hint="Κάτω από αυτό = alert + scaling" icon={AlertTriangle} />
                <Field label="Critical threshold (€)" value={pricing.pool_critical_threshold} onChange={v => setPricing(p => ({ ...p, pool_critical_threshold: v }))} hint="Κάτω από αυτό = critical multiplier" />
                <Field label="Low ×" value={pricing.pool_low_multiplier} onChange={v => setPricing(p => ({ ...p, pool_low_multiplier: v }))} hint="0–1, π.χ. 0.85" step="0.05" />
                <Field label="Critical ×" value={pricing.pool_critical_multiplier} onChange={v => setPricing(p => ({ ...p, pool_critical_multiplier: v }))} hint="0–1, π.χ. 0.6" step="0.05" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-start gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
                  <input type="checkbox" className="mt-1" checked={pricing.pause_bonus_when_critical} onChange={e => setPricing(p => ({ ...p, pause_bonus_when_critical: e.target.checked }))} />
                  <div className="text-xs">
                    <p className="font-bold text-foreground">Auto-pause bonus σε κρίσιμο basket</p>
                    <p className="text-muted-foreground mt-0.5">Όταν το basket πέσει κάτω από το critical threshold, το bonus γίνεται €0 μέχρι να γεμίσει ξανά. Ο οδηγός παίρνει μόνο delivery fee + tip.</p>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
                  <input type="checkbox" className="mt-1" checked={pricing.subsidize_min_pay} onChange={e => setPricing(p => ({ ...p, subsidize_min_pay: e.target.checked }))} />
                  <div className="text-xs">
                    <p className="font-bold text-foreground">Admin καλύπτει το min όταν αδειάζει το pool</p>
                    <p className="text-muted-foreground mt-0.5">Αν το pool δεν φτάνει, το admin bag πληρώνει τη διαφορά μέχρι το ελάχιστο. Καταγράφεται ως subsidy.</p>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
                  <input type="checkbox" className="mt-1" checked={pricing.pool_alert_enabled} onChange={e => setPricing(p => ({ ...p, pool_alert_enabled: e.target.checked }))} />
                  <div className="text-xs">
                    <p className="font-bold text-foreground">Ενεργοποίηση alert χαμηλού pool</p>
                    <p className="text-muted-foreground mt-0.5">Στέλνει εγγραφή στο Activity Log όταν το pool πέφτει κάτω από το low threshold (max 1 ανά 24h).</p>
                  </div>
                </label>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm space-y-1.5">
                <p className="text-xs text-muted-foreground">Live preview — πραγματικό pool: <b className="text-foreground">€{poolBalance.toFixed(2)}</b> · κατάσταση: <b className={
                  healthLabel === 'υγιές' ? 'text-emerald-600' :
                  healthLabel === 'κανονικό' ? 'text-foreground' :
                  healthLabel === 'χαμηλό' ? 'text-amber-600' : 'text-destructive'
                }>{healthLabel}</b> · multiplier: <b>×{mult.toFixed(2)}</b>{isPaused && <> · <b className="text-destructive">PAUSED</b></>}</p>
                {isPaused
                  ? <p>Bonus σε pause → <b className="text-destructive">€{finalBonus.toFixed(2)}</b> {pricing.subsidize_min_pay && <span className="text-[11px]">(admin subsidy)</span>}</p>
                  : <p>Παράδοση {previewKm} χλμ → bonus = clamp(€{rawBonus.toFixed(2)}, €{pricing.min_pay}, €{pricing.max_pay}) × {mult.toFixed(2)} = <b className="text-primary">€{finalBonus.toFixed(2)}</b></p>}
                <p className="text-[11px] text-muted-foreground">Σύνολο για τον οδηγό: delivery fee €{driverDeliveryPay.toFixed(2)} + bonus €{finalBonus.toFixed(2)} + tip = <b>€{(driverDeliveryPay + finalBonus).toFixed(2)}</b> (χωρίς tip).</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customer" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="font-heading text-base flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" />Χρέωση Παράδοσης Πελάτη</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Βασική Χρέωση (€)" value={pricing.customer_base_fee} onChange={v => setPricing(p => ({ ...p, customer_base_fee: v }))} hint="Πληρώνει ο πελάτης" />
                <Field label="Χρέωση ανά χλμ (€)" value={pricing.customer_per_km_fee} onChange={v => setPricing(p => ({ ...p, customer_per_km_fee: v }))} hint="Επιπλέον €/km" icon={MapPin} />
                <Field label="Service Fee Πλατφόρμας (€)" value={pricing.platform_service_fee} onChange={v => setPricing(p => ({ ...p, platform_service_fee: v }))} hint="Σταθερό fee ανά παραγγελία (πρώην 0,99€)" step="0.01" icon={Shield} />
              </div>
              <Preview label={`Παράδοση ${previewKm} χλμ`} amount={customerFee + pricing.platform_service_fee} note={`€${pricing.customer_base_fee.toFixed(2)} + ${previewKm} × €${pricing.customer_per_km_fee.toFixed(2)} + €${pricing.platform_service_fee.toFixed(2)} service`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="font-heading text-base flex items-center gap-2"><Percent className="h-4 w-4 text-primary" />Προμήθεια Πλατφόρμας (κλειδωμένο 85/10/5)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Συνολική Προμήθεια %" value={pricing.default_commission_pct} onChange={v => setPricing(p => ({ ...p, default_commission_pct: Math.max(15, v) }))} hint="Min 15% — override ανά store" icon={Percent} />
                <Field label="Admin bag %" value={pricing.admin_share_pct} onChange={v => setPricing(p => ({ ...p, admin_share_pct: Math.max(5, v) }))} hint="Min 5% του food subtotal" icon={Shield} />
                <Field label="Driver pool %" value={pricing.driver_pool_pct_of_subtotal} onChange={v => setPricing(p => ({ ...p, driver_pool_pct_of_subtotal: Math.max(10, v) }))} hint="Min 10% — top-ups οδηγών" />
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm space-y-1">
                <p className="text-xs text-muted-foreground mb-1">Διαχωρισμός σε παραγγελία €100 food subtotal</p>
                <p>🏪 Store κρατάει: <span className="font-bold">€{(100 - pricing.default_commission_pct).toFixed(2)}</span> ({(100 - pricing.default_commission_pct).toFixed(0)}%)</p>
                <p>🚴 Driver pool: <span className="font-bold text-emerald-700">€{pricing.driver_pool_pct_of_subtotal.toFixed(2)}</span> ({pricing.driver_pool_pct_of_subtotal}%)</p>
                <p>🛡️ Admin bag: <span className="font-bold text-amber-600">€{pricing.admin_share_pct.toFixed(2)}</span> ({pricing.admin_share_pct}%)</p>
                {pricing.default_commission_pct > pricing.admin_share_pct + pricing.driver_pool_pct_of_subtotal && (
                  <p>💼 Extra (platform pool): <span className="font-bold">€{(pricing.default_commission_pct - pricing.admin_share_pct - pricing.driver_pool_pct_of_subtotal).toFixed(2)}</span></p>
                )}
                <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50 mt-2">
                  Ισχύει για όλες τις παραγγελίες (internal + external). Floor: 5% admin + 10% driver pool σε κάθε παραγγελία.
                  Stores μπορούν να κάνουν toggle "Δωρεάν Παράδοση" — τότε χρεώνονται το delivery fee από το wallet τους.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="peak" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="font-heading text-base flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" />Peak-Hour Bonus</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Πολλαπλασιαστής" value={pricing.peak_multiplier} onChange={v => setPricing(p => ({ ...p, peak_multiplier: v }))} hint="π.χ. 1.3 = +30%" step="0.05" />
                <Field label="Από ώρα" value={pricing.peak_start_hour} onChange={v => setPricing(p => ({ ...p, peak_start_hour: Math.round(v) }))} hint="0-23" step="1" />
                <Field label="Έως ώρα" value={pricing.peak_end_hour} onChange={v => setPricing(p => ({ ...p, peak_end_hour: Math.round(v) }))} hint="0-23" step="1" />
              </div>
              <div>
                <Label className="text-sm">Ενεργές Ημέρες</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {DAYS.map(d => (
                    <Button key={d.n} type="button" size="sm" variant={pricing.peak_weekdays.includes(d.n) ? 'default' : 'outline'} onClick={() => toggleDay(d.n)}>
                      {d.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vehicle" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="font-heading text-base">Πολλαπλασιαστές Οχήματος</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Ποδήλατο ×" value={pricing.bike_multiplier} onChange={v => setPricing(p => ({ ...p, bike_multiplier: v }))} hint="Bonus για bike" step="0.05" icon={Bike} />
              <Field label="Μηχανή ×" value={pricing.motorcycle_multiplier} onChange={v => setPricing(p => ({ ...p, motorcycle_multiplier: v }))} hint="Default" step="0.05" />
              <Field label="Αυτοκίνητο ×" value={pricing.car_multiplier} onChange={v => setPricing(p => ({ ...p, car_multiplier: v }))} hint="Bonus για car" step="0.05" icon={Car} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tiers" className="mt-4">
          <CommissionTiersPanel />
        </TabsContent>

        <TabsContent value="stores" className="mt-4">
          <StorePricingOverrides defaultCommission={pricing.default_commission_pct} />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gradient-primary text-primary-foreground font-heading">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Αποθήκευση Όλων
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, hint, step = '0.10', icon: Icon }: any) {
  return (
    <div>
      <Label className="flex items-center gap-1 text-sm">{Icon && <Icon className="h-3 w-3" />}{label}</Label>
      <Input type="number" step={step} min="0" value={value} onChange={e => onChange(Number(e.target.value))} />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function Preview({ label, amount, note }: { label: string; amount: number; note: string }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="text-xs text-muted-foreground">Προεπισκόπηση</p>
      <p className="font-heading text-sm">
        {label} = <span className="font-bold text-primary">€{amount.toFixed(2)}</span>
        <span className="text-muted-foreground text-xs ml-2">({note})</span>
      </p>
    </div>
  );
}
