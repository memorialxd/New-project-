import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Loader2, Save, Target, Radio, Layers, Sparkles, Bike, Car, Filter, Scale, HandCoins, Route } from 'lucide-react';
import { toast } from 'sonner';

const MODES = [
  {
    key: 'nearest',
    label: 'Πλησιέστερος Οδηγός',
    desc: 'Αυτόματη ανάθεση στον πιο κοντινό διαθέσιμο οδηγό.',
    Icon: Target,
    tone: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30',
  },
  {
    key: 'broadcast',
    label: 'Broadcast σε Όλους',
    desc: 'Όλοι οι κοντινοί οδηγοί λαμβάνουν την προσφορά. Ο πρώτος που αποδέχεται κερδίζει.',
    Icon: Radio,
    tone: 'text-blue-600 bg-blue-500/10 border-blue-500/30',
  },
  {
    key: 'batched',
    label: 'Κύματα (Batched)',
    desc: 'Προσφορά στους Top N. Αν δεν αποδεχτούν, επόμενο κύμα.',
    Icon: Layers,
    tone: 'text-orange-600 bg-orange-500/10 border-orange-500/30',
  },
  {
    key: 'fair_earnings',
    label: 'Δίκαιες Αμοιβές (€/ώρα)',
    desc: 'Σαν "Πλησιέστερος", αλλά προτεραιότητα σε οδηγούς που έχουν βγάλει λιγότερα — στόχος να φτάσουν όλοι τα €/ώρα.',
    Icon: HandCoins,
    tone: 'text-amber-600 bg-amber-500/10 border-amber-500/30',
  },
  {
    key: 'smart',
    label: 'Smart (Rating + Δικαιοσύνη)',
    desc: 'Σταθμισμένη βαθμολογία βάσει απόστασης, rating, και δικαιοσύνης (round-robin).',
    Icon: Sparkles,
    tone: 'text-purple-600 bg-purple-500/10 border-purple-500/30',
  },
] as const;

const FAIR_TARGET_KEY = 'admin.dist.fair_hourly_target';

interface Settings {
  distribution_mode: string;
  dist_search_radius_km: number;
  dist_offer_timeout_seconds: number;
  dist_wave_size: number;
  dist_max_waves: number;
  dist_vehicle_rules_enabled: boolean;
  dist_bike_max_km: number;
  dist_motorcycle_max_km: number;
  dist_car_min_value: number;
  dist_min_driver_rating: number;
  dist_min_acceptance_rate: number;
  dist_fairness_weight: number;
  dist_rating_weight: number;
  dist_distance_weight: number;
  max_stacked_orders: number;
  stack_max_detour_minutes: number;
  stacking_enabled: boolean;
}

export default function AssignmentSettings() {
  const qc = useQueryClient();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [fairTarget, setFairTarget] = useState<number>(() => {
    const v = Number(localStorage.getItem(FAIR_TARGET_KEY));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  const [fairWindow, setFairWindow] = useState<number>(() => {
    const v = Number(localStorage.getItem(FAIR_TARGET_KEY + '.window'));
    return Number.isFinite(v) && v > 0 ? v : 6;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['platform-distribution-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('distribution_mode, dist_search_radius_km, dist_offer_timeout_seconds, dist_wave_size, dist_max_waves, dist_vehicle_rules_enabled, dist_bike_max_km, dist_motorcycle_max_km, dist_car_min_value, dist_min_driver_rating, dist_min_acceptance_rate, dist_fairness_weight, dist_rating_weight, dist_distance_weight, max_stacked_orders, stack_max_detour_minutes, stacking_enabled')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data as Settings | null;
    },
  });

  useEffect(() => {
    if (data) setS(data);
  }, [data]);

  if (isLoading || !s) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const update = <K extends keyof Settings>(key: K, val: Settings[K]) => setS({ ...s, [key]: val });

  const save = async () => {
    setSaving(true);
    localStorage.setItem(FAIR_TARGET_KEY, String(fairTarget));
    localStorage.setItem(FAIR_TARGET_KEY + '.window', String(fairWindow));
    const { error } = await supabase
      .from('platform_settings')
      .update(s as any)
      .eq('id', 1);
    setSaving(false);
    if (error) {
      toast.error('Αποτυχία αποθήκευσης: ' + error.message);
    } else {
      toast.success('Οι ρυθμίσεις διανομής αποθηκεύτηκαν');
      qc.invalidateQueries({ queryKey: ['platform-distribution-settings'] });
    }
  };

  // Normalize smart-mode weights so they always sum to 1
  const normalizeWeights = () => {
    const total = s.dist_fairness_weight + s.dist_rating_weight + s.dist_distance_weight;
    if (total <= 0) return;
    setS({
      ...s,
      dist_fairness_weight: +(s.dist_fairness_weight / total).toFixed(2),
      dist_rating_weight: +(s.dist_rating_weight / total).toFixed(2),
      dist_distance_weight: +(s.dist_distance_weight / total).toFixed(2),
    });
  };

  const weightSum = (s.dist_fairness_weight + s.dist_rating_weight + s.dist_distance_weight).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Mode picker */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Λειτουργία Διανομής Παραγγελιών
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            {MODES.map((m) => {
              const active = s.distribution_mode === m.key;
              const Icon = m.Icon;
              return (
                <button
                  key={m.key}
                  onClick={() => update('distribution_mode', m.key)}
                  className={`text-left rounded-lg border-2 p-3 transition-all ${
                    active ? `border-primary ${m.tone}` : 'border-border hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4" />
                    <span className="font-heading font-semibold text-sm">{m.label}</span>
                    {active && <Badge variant="outline" className="ml-auto text-[10px]">Ενεργό</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Fair earnings target — only meaningful when fair_earnings mode is active */}
      <Card className={s.distribution_mode === 'fair_earnings' ? '' : 'opacity-60'}>
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-amber-600" /> Δίκαιες Αμοιβές · Στόχος €/ώρα
          </CardTitle>
        </CardHeader>
        <CardContent className={`space-y-3 ${s.distribution_mode !== 'fair_earnings' ? 'pointer-events-none' : ''}`}>
          <p className="text-xs text-muted-foreground">
            Οι παραγγελίες πηγαίνουν στον πιο κοντινό διαθέσιμο οδηγό, αλλά με προτεραιότητα σε όσους έχουν βγάλει
            λιγότερα στο παράθυρο. Στόχος: όλοι οι οδηγοί να φτάνουν τα <b>€{fairTarget.toFixed(0)}/ώρα</b>.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] uppercase">Στόχος €/ώρα ανά οδηγό</Label>
              <Input
                type="number"
                min={1}
                step={0.5}
                value={fairTarget}
                onChange={(e) => setFairTarget(parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[11px] uppercase">Παράθυρο υπολογισμού (ώρες)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={fairWindow}
                onChange={(e) => setFairWindow(parseFloat(e.target.value) || 1)}
                className="h-9"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Παράδειγμα: ένας οδηγός online 4 ώρες με €24 κερδών είναι €6/ώρα — θα προτιμηθεί έναντι ενός που είναι ήδη πάνω από €10/ώρα,
            αν και οι δύο είναι σε λογική απόσταση.
          </p>
        </CardContent>
      </Card>

      {/* Core parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Παράμετροι
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-[11px] uppercase">Ακτίνα αναζήτησης (km)</Label>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={s.dist_search_radius_km}
                onChange={(e) => update('dist_search_radius_km', parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[11px] uppercase">Λήξη προσφοράς (δ)</Label>
              <Input
                type="number"
                min={5}
                value={s.dist_offer_timeout_seconds}
                onChange={(e) => update('dist_offer_timeout_seconds', parseInt(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className={s.distribution_mode === 'batched' ? '' : 'opacity-50'}>
              <Label className="text-[11px] uppercase">Μέγεθος κύματος</Label>
              <Input
                type="number"
                min={1}
                value={s.dist_wave_size}
                onChange={(e) => update('dist_wave_size', parseInt(e.target.value) || 1)}
                className="h-9"
                disabled={s.distribution_mode !== 'batched'}
              />
            </div>
            <div className={s.distribution_mode === 'batched' ? '' : 'opacity-50'}>
              <Label className="text-[11px] uppercase">Μέγιστα κύματα</Label>
              <Input
                type="number"
                min={1}
                value={s.dist_max_waves}
                onChange={(e) => update('dist_max_waves', parseInt(e.target.value) || 1)}
                className="h-9"
                disabled={s.distribution_mode !== 'batched'}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vehicle rules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Bike className="h-4 w-4 text-primary" /> Κανόνες Οχήματος
          </CardTitle>
          <Switch
            checked={s.dist_vehicle_rules_enabled}
            onCheckedChange={(v) => update('dist_vehicle_rules_enabled', v)}
          />
        </CardHeader>
        <CardContent className={`space-y-3 ${s.dist_vehicle_rules_enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <p className="text-xs text-muted-foreground">
            Ταιριάζει το όχημα με την παραγγελία (ποδήλατα/μηχανές για κοντινές, αυτοκίνητα για μεγάλες).
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-[11px] uppercase flex items-center gap-1">
                <Bike className="h-3 w-3" /> Bike μέχρι (km)
              </Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={s.dist_bike_max_km}
                onChange={(e) => update('dist_bike_max_km', parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[11px] uppercase">Μηχανή μέχρι (km)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={s.dist_motorcycle_max_km}
                onChange={(e) => update('dist_motorcycle_max_km', parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[11px] uppercase flex items-center gap-1">
                <Car className="h-3 w-3" /> Αυτοκίνητο ≥ €
              </Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={s.dist_car_min_value}
                onChange={(e) => update('dist_car_min_value', parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Eligibility filters */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Φίλτρα Επιλεξιμότητας Οδηγού
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[11px] uppercase">Ελάχιστο rating οδηγού</Label>
              <Badge variant="outline">{s.dist_min_driver_rating.toFixed(1)} ★</Badge>
            </div>
            <Slider
              value={[s.dist_min_driver_rating]}
              max={5}
              step={0.1}
              onValueChange={([v]) => update('dist_min_driver_rating', v)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[11px] uppercase">Ελάχιστο acceptance rate</Label>
              <Badge variant="outline">{Math.round(s.dist_min_acceptance_rate * 100)}%</Badge>
            </div>
            <Slider
              value={[s.dist_min_acceptance_rate]}
              max={1}
              step={0.05}
              onValueChange={([v]) => update('dist_min_acceptance_rate', v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Smart mode weights */}
      <Card className={s.distribution_mode === 'smart' ? '' : 'opacity-60'}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" /> Βάρη Smart Mode
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={normalizeWeights} disabled={s.distribution_mode !== 'smart'} className="h-7 text-xs">
            Κανονικοποίηση
          </Button>
        </CardHeader>
        <CardContent className={`space-y-4 ${s.distribution_mode !== 'smart' ? 'pointer-events-none' : ''}`}>
          <p className="text-xs text-muted-foreground">
            Σύνολο βαρών: <span className={`font-mono ${weightSum === '1.00' ? 'text-emerald-600' : 'text-orange-500'}`}>{weightSum}</span> (ιδανικά 1.00)
          </p>
          {(['dist_distance_weight', 'dist_rating_weight', 'dist_fairness_weight'] as const).map((k) => {
            const labelMap: Record<string, string> = {
              dist_distance_weight: 'Απόσταση',
              dist_rating_weight: 'Rating',
              dist_fairness_weight: 'Δικαιοσύνη (round-robin)',
            };
            return (
              <div key={k}>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-[11px] uppercase">{labelMap[k]}</Label>
                  <Badge variant="outline">{s[k].toFixed(2)}</Badge>
                </div>
                <Slider
                  value={[s[k] as number]}
                  max={1}
                  step={0.05}
                  onValueChange={([v]) => update(k, v as any)}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Smart stacking */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" /> Smart Stacking · Πολλαπλές Παραγγελίες
          </CardTitle>
          <Switch
            checked={s.stacking_enabled}
            onCheckedChange={(v) => update('stacking_enabled', v)}
          />
        </CardHeader>
        <CardContent className={`space-y-3 ${s.stacking_enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <p className="text-xs text-muted-foreground">
            Επιτρέπει σε έναν οδηγό να μεταφέρει έως {s.max_stacked_orders} παραγγελίες ταυτόχρονα. Νέες προσφορές
            δίνονται μόνο όταν το επιπλέον στοπ είναι στη διαδρομή (ίδιο κατάστημα).
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] uppercase">Μέγιστες ταυτόχρονες (1–3)</Label>
              <Input
                type="number"
                min={1}
                max={3}
                value={s.max_stacked_orders}
                onChange={(e) => update('max_stacked_orders', Math.min(3, Math.max(1, parseInt(e.target.value) || 1)))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[11px] uppercase">Max παράκαμψη (λεπτά)</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={s.stack_max_detour_minutes}
                onChange={(e) => update('stack_max_detour_minutes', parseInt(e.target.value) || 0)}
                className="h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Αποθήκευση Ρυθμίσεων Διανομής
      </Button>
    </div>
  );
}
