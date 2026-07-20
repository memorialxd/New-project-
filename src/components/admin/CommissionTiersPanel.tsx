import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Layers } from 'lucide-react';
import { toast } from 'sonner';

interface Tier {
  id: string;
  min_amount: number;
  max_amount: number | null;
  commission_pct: number;
  label: string | null;
  is_active: boolean;
}

export default function CommissionTiersPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ min_amount: '', max_amount: '', commission_pct: '', label: '' });

  const { data: tiers, isLoading } = useQuery({
    queryKey: ['commission-tiers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('commission_tiers')
        .select('*')
        .order('min_amount', { ascending: true });
      if (error) throw error;
      return data as Tier[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['commission-tiers'] });

  const addTier = async () => {
    const min = parseFloat(draft.min_amount || '0');
    const max = draft.max_amount === '' ? null : parseFloat(draft.max_amount);
    const pct = parseFloat(draft.commission_pct);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Το commission % πρέπει να είναι 0–100');
      return;
    }
    if (max !== null && max <= min) {
      toast.error('Το max πρέπει να είναι > min');
      return;
    }
    const { error } = await (supabase as any).from('commission_tiers').insert({
      min_amount: min,
      max_amount: max,
      commission_pct: pct,
      label: draft.label || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Tier προστέθηκε');
    setDraft({ min_amount: '', max_amount: '', commission_pct: '', label: '' });
    refresh();
  };

  const updateTier = async (id: string, patch: Partial<Tier>) => {
    const { error } = await (supabase as any).from('commission_tiers').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const deleteTier = async (id: string) => {
    const { error } = await (supabase as any).from('commission_tiers').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Διαγράφηκε');
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2">
          <Layers className="h-4 w-4" /> Κλιμάκια Προμήθειας (Commission Tiers)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Όσο μεγαλύτερη η παραγγελία, τόσο μικρότερη η προμήθεια — ή το αντίθετο. Το override του καταστήματος υπερισχύει.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Φόρτωση…</p>
        ) : (
          <div className="space-y-2">
            {tiers?.map((t) => (
              <div key={t.id} className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg border bg-card">
                <div className="col-span-12 md:col-span-3">
                  <Label className="text-[10px] text-muted-foreground">Από €</Label>
                  <Input type="number" step="0.01" defaultValue={t.min_amount}
                    onBlur={(e) => updateTier(t.id, { min_amount: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="col-span-12 md:col-span-3">
                  <Label className="text-[10px] text-muted-foreground">Έως € (κενό = ∞)</Label>
                  <Input type="number" step="0.01" defaultValue={t.max_amount ?? ''}
                    onBlur={(e) => updateTier(t.id, { max_amount: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-[10px] text-muted-foreground">Προμήθεια %</Label>
                  <Input type="number" step="0.01" defaultValue={t.commission_pct}
                    onBlur={(e) => updateTier(t.id, { commission_pct: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-[10px] text-muted-foreground">Ετικέτα</Label>
                  <Input defaultValue={t.label ?? ''} placeholder="π.χ. Μικρές"
                    onBlur={(e) => updateTier(t.id, { label: e.target.value || null })} />
                </div>
                <div className="col-span-12 md:col-span-2 flex items-end justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={t.is_active}
                      onCheckedChange={(v) => updateTier(t.id, { is_active: v })} />
                    <Badge variant={t.is_active ? 'default' : 'secondary'} className="text-[10px]">
                      {t.is_active ? 'Ενεργό' : 'Off'}
                    </Badge>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteTier(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            {!tiers?.length && (
              <p className="text-sm text-muted-foreground text-center py-4">Δεν υπάρχουν tiers.</p>
            )}
          </div>
        )}

        <div className="border-t pt-4 space-y-2">
          <p className="text-xs font-heading uppercase tracking-wider text-muted-foreground">Προσθήκη tier</p>
          <div className="grid grid-cols-12 gap-2">
            <Input className="col-span-6 md:col-span-3" placeholder="Από € (0)" type="number" step="0.01"
              value={draft.min_amount} onChange={(e) => setDraft({ ...draft, min_amount: e.target.value })} />
            <Input className="col-span-6 md:col-span-3" placeholder="Έως € (κενό=∞)" type="number" step="0.01"
              value={draft.max_amount} onChange={(e) => setDraft({ ...draft, max_amount: e.target.value })} />
            <Input className="col-span-4 md:col-span-2" placeholder="% π.χ. 15" type="number" step="0.01"
              value={draft.commission_pct} onChange={(e) => setDraft({ ...draft, commission_pct: e.target.value })} />
            <Input className="col-span-4 md:col-span-2" placeholder="Ετικέτα"
              value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <Button className="col-span-4 md:col-span-2" onClick={addTier}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
