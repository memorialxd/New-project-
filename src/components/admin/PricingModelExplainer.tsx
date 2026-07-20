import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Coins, Store, Bike, Wallet, Info } from 'lucide-react';

/**
 * Static explainer of how the platform charges stores and pays drivers.
 * Pulls live percentages from `v_pricing_model` so the numbers always
 * match what the settle_order_commission trigger actually applies.
 *
 * Worked example uses food €20 + delivery €2 + tip €1.
 */
export default function PricingModelExplainer() {
  const { data } = useQuery({
    queryKey: ['pricing-model'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_pricing_model').select('*').maybeSingle();
      if (error) throw error;
      return data as {
        admin_pct: number;
        driver_pool_pct: number;
        default_commission_pct: number;
        default_store_keeps_pct: number;
      } | null;
    },
  });

  const adminPct = data?.admin_pct ?? 5;
  const poolPct = data?.driver_pool_pct ?? 10;
  const commPct = data?.default_commission_pct ?? 15;
  const storeKeeps = data?.default_store_keeps_pct ?? 85;

  // Worked example
  const food = 20;
  const delivery = 2;
  const tip = 1;
  const adminAmt = +(food * adminPct / 100).toFixed(2);
  const poolAmt = +(food * poolPct / 100).toFixed(2);
  const storeAmt = +(food * storeKeeps / 100).toFixed(2);
  const driverAmt = +(delivery + tip).toFixed(2);

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          Πώς χρεώνονται καταστήματα & πληρώνονται οδηγοί
        </CardTitle>
        <p className="text-[12px] text-muted-foreground mt-1">
          Κάθε παράδοση σπάει σε <b>3 κομμάτια</b> με βάση το <i>food subtotal</i> (χωρίς delivery & tip).
          Τα ποσοστά διαβάζονται live από τις ρυθμίσεις πλατφόρμας.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Split chips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 mb-1">
              <Store className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-[12px] font-semibold">Κατάστημα</span>
              <Badge variant="secondary" className="ml-auto text-[11px]">{storeKeeps}%</Badge>
            </div>
            <p className="text-[11.5px] text-muted-foreground leading-snug">
              Κρατά {storeKeeps}% του food subtotal. Πληρώνει {commPct}% προμήθεια στην πλατφόρμα.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 mb-1">
              <Coins className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-[12px] font-semibold">Admin</span>
              <Badge variant="secondary" className="ml-auto text-[11px]">{adminPct}%</Badge>
            </div>
            <p className="text-[11.5px] text-muted-foreground leading-snug">
              {adminPct}% πάει στο ταμείο admin (καθαρό κέρδος πλατφόρμας).
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <span className="text-[12px] font-semibold">Driver Pool</span>
              <Badge variant="secondary" className="ml-auto text-[11px]">{poolPct}%</Badge>
            </div>
            <p className="text-[11.5px] text-muted-foreground leading-snug">
              {poolPct}% στο Driver Pool — bonuses, top-ups, εγγυήσεις πληρωμής.
            </p>
          </div>
        </div>

        {/* Driver payment */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Bike className="h-3.5 w-3.5 text-primary" />
            <span className="text-[12px] font-semibold">Πληρωμή οδηγού ανά παράδοση</span>
          </div>
          <ul className="text-[12px] text-muted-foreground space-y-0.5 list-disc pl-4">
            <li><b>Delivery fee</b> (ολόκληρο) — πιστώνεται στο πορτοφόλι του οδηγού</li>
            <li><b>Tip</b> (ολόκληρο) — πιστώνεται στο πορτοφόλι του οδηγού</li>
            <li>Σε <b>μετρητά</b>: ο οδηγός κρατά delivery+tip και χρωστά admin+pool+store στο ταμείο</li>
            <li>Bonuses από Driver Pool (wait time, peak zones) προστίθενται ξεχωριστά</li>
          </ul>
        </div>

        {/* Worked example */}
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <div className="text-[12px] font-semibold mb-2">
            Παράδειγμα: Φαγητό €{food.toFixed(2)} + Delivery €{delivery.toFixed(2)} + Tip €{tip.toFixed(2)}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] tabular-nums">
            <span className="text-muted-foreground">Κατάστημα κρατά</span>
            <span className="text-right text-emerald-600 font-medium">€{storeAmt.toFixed(2)}</span>
            <span className="text-muted-foreground">Admin ταμείο (+{adminPct}%)</span>
            <span className="text-right text-amber-600 font-medium">€{adminAmt.toFixed(2)}</span>
            <span className="text-muted-foreground">Driver Pool (+{poolPct}%)</span>
            <span className="text-right text-primary font-medium">€{poolAmt.toFixed(2)}</span>
            <span className="text-muted-foreground">Οδηγός παίρνει (delivery+tip)</span>
            <span className="text-right text-foreground font-semibold">€{driverAmt.toFixed(2)}</span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground italic">
          Tip: Άλλαξε τα ποσοστά από <b>Ρυθμίσεις → Commission Tiers</b>. Κάθε κατάστημα μπορεί να έχει custom % — ό,τι ξεπερνά το {adminPct + poolPct}% πάει στο Driver Pool.
        </p>
      </CardContent>
    </Card>
  );
}
