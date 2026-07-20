import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Save, Trash2 } from 'lucide-react';

interface StoreRow { id: string; name: string; }
interface OverrideRow {
  store_id: string;
  base_pay: number | null;
  first_km_price: number | null;
  per_km_rate: number | null;
  min_pay: number | null;
  commission_pct: number | null;
}

export default function StorePricingOverrides({ defaultCommission }: { defaultCommission: number }) {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('store_pricing_overrides' as any).select('*'),
    ]).then(([s, o]) => {
      setStores((s.data ?? []) as any);
      const map: Record<string, OverrideRow> = {};
      ((o.data ?? []) as any[]).forEach((r: any) => { map[r.store_id] = r; });
      setOverrides(map);
      setLoading(false);
    });
  }, []);

  const update = (storeId: string, field: keyof OverrideRow, value: string) => {
    const num = value === '' ? null : Number(value);
    setOverrides(prev => ({
      ...prev,
      [storeId]: { ...(prev[storeId] ?? { store_id: storeId, base_pay: null, first_km_price: null, per_km_rate: null, min_pay: null, commission_pct: null }), [field]: num },
    }));
  };

  const save = async (storeId: string) => {
    setSavingId(storeId);
    const row = overrides[storeId] ?? { store_id: storeId, base_pay: null, first_km_price: null, per_km_rate: null, min_pay: null, commission_pct: null };
    const { error } = await supabase.from('store_pricing_overrides' as any).upsert(row as any, { onConflict: 'store_id' });
    setSavingId(null);
    if (error) toast.error('Αποτυχία'); else toast.success('Αποθηκεύτηκε');
  };

  const clear = async (storeId: string) => {
    setSavingId(storeId);
    const { error } = await supabase.from('store_pricing_overrides' as any).delete().eq('store_id', storeId);
    setSavingId(null);
    if (error) toast.error('Αποτυχία');
    else {
      setOverrides(prev => { const { [storeId]: _, ...rest } = prev; return rest; });
      toast.success('Καθαρίστηκε - επιστροφή σε global τιμές');
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Κατάστημα</TableHead>
              <TableHead className="w-24">1ο χλμ €</TableHead>
              <TableHead className="w-24">€/km</TableHead>
              <TableHead className="w-24">Min €</TableHead>
              <TableHead className="w-28">Προμήθεια %</TableHead>
              <TableHead className="w-32">Ενέργειες</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map(s => {
              const ov = overrides[s.id];
              const has = !!ov;
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Input type="number" step="0.10" placeholder="—" value={ov?.first_km_price ?? ''} onChange={e => update(s.id, 'first_km_price', e.target.value)} className="h-8" /></TableCell>
                  <TableCell><Input type="number" step="0.05" placeholder="—" value={ov?.per_km_rate ?? ''} onChange={e => update(s.id, 'per_km_rate', e.target.value)} className="h-8" /></TableCell>
                  <TableCell><Input type="number" step="0.10" placeholder="—" value={ov?.min_pay ?? ''} onChange={e => update(s.id, 'min_pay', e.target.value)} className="h-8" /></TableCell>
                  <TableCell><Input type="number" step="0.5" placeholder={String(defaultCommission)} value={ov?.commission_pct ?? ''} onChange={e => update(s.id, 'commission_pct', e.target.value)} className="h-8" /></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => save(s.id)} disabled={savingId === s.id}>
                        <Save className="h-3 w-3" />
                      </Button>
                      {has && (
                        <Button size="sm" variant="outline" onClick={() => clear(s.id)} disabled={savingId === s.id}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!stores.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Κανένα κατάστημα</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
