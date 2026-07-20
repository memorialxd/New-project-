import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Save, Layers } from 'lucide-react';

interface Row {
  id: string;
  name: string;
  ext_billing_mode: string;
  ext_commission_pct: number;
  ext_flat_fee: number;
  ext_margin_pct: number;
}

export default function StoreBillingSettings() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, ext_billing_mode, ext_commission_pct, ext_flat_fee, ext_margin_pct' as any)
      .order('name')
      .then(({ data }) => {
        setRows((data as unknown as Row[]) ?? []);
        setLoading(false);
      });
  }, []);

  const update = (id: string, patch: Partial<Row>) =>
    setRows(p => p.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const save = async (r: Row) => {
    setSavingId(r.id);
    const { error } = await supabase
      .from('stores')
      .update({
        ext_billing_mode: r.ext_billing_mode,
        ext_commission_pct: r.ext_commission_pct,
        ext_flat_fee: r.ext_flat_fee,
        ext_margin_pct: r.ext_margin_pct,
      } as any)
      .eq('id', r.id);
    setSavingId(null);
    if (error) toast.error(error.message);
    else toast.success(`${r.name} ενημερώθηκε`);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h2 className="font-heading font-bold text-xl">Χρέωση Καταστημάτων (Εξωτερικές Παραγγελίες)</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Πώς πληρώνει κάθε κατάστημα την πλατφόρμα όταν χειρίζεσαι παραγγελίες από eFood / Wolt / Box.
        </p>
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground/80 leading-relaxed">
          <span className="font-heading font-bold text-primary">📊 Tiered (default)</span> — οι external χρεώνονται με τα ίδια commission tiers όπως οι internal παραγγελίες (πχ 15%). Η προμήθεια πάει στο ενοποιημένο Driver Pool που πληρώνει και τους οδηγούς. Μία τσάντα — απλό, σταθερό, χωρίς buffer.
        </div>
      </div>

      <div className="space-y-3">
        {rows.map(r => {
          const isTiered = r.ext_billing_mode === 'tiered' || !r.ext_billing_mode;
          return (
            <Card key={r.id}>
              <CardContent className="pt-5 space-y-3">
                <div className="grid lg:grid-cols-[1.5fr,1.2fr,auto] gap-3 items-end">
                  <div>
                    <Label className="text-xs text-muted-foreground">Κατάστημα</Label>
                    <p className="font-heading font-bold text-sm mt-1 flex items-center gap-2">
                      {r.name}
                      {isTiered && <Badge variant="outline" className="gap-1 border-primary/40 text-primary text-[10px]"><Layers className="h-3 w-3" /> Tiered</Badge>}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">Μοντέλο</Label>
                    <Select value={r.ext_billing_mode || 'tiered'} onValueChange={v => update(r.id, { ext_billing_mode: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tiered">📊 Tiered (όπως internal)</SelectItem>
                        <SelectItem value="commission">Σταθερή προμήθεια %</SelectItem>
                        <SelectItem value="flat_fee">Σταθερό €</SelectItem>
                        <SelectItem value="driver_plus_margin">Οδηγός + %</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => save(r)} disabled={savingId === r.id} size="sm" className="h-9">
                    {savingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Αποθήκευση</>}
                  </Button>
                </div>

                {!isTiered && (
                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/60">
                    <div>
                      <Label className="text-xs">Προμήθεια %</Label>
                      <Input type="number" step="0.5" min="0"
                        disabled={r.ext_billing_mode !== 'commission'}
                        value={r.ext_commission_pct}
                        onChange={e => update(r.id, { ext_commission_pct: Number(e.target.value) })}
                        className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs">Σταθερό (€)</Label>
                      <Input type="number" step="0.5" min="0"
                        disabled={r.ext_billing_mode !== 'flat_fee'}
                        value={r.ext_flat_fee}
                        onChange={e => update(r.id, { ext_flat_fee: Number(e.target.value) })}
                        className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs">Margin %</Label>
                      <Input type="number" step="1" min="0"
                        disabled={r.ext_billing_mode !== 'driver_plus_margin'}
                        value={r.ext_margin_pct}
                        onChange={e => update(r.id, { ext_margin_pct: Number(e.target.value) })}
                        className="h-9" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {!rows.length && <p className="text-sm text-muted-foreground text-center py-8">Κανένα κατάστημα.</p>}
      </div>
    </div>
  );
}
