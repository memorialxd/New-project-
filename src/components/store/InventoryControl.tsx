import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, AlertTriangle, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useMenuItems } from '@/hooks/useMenuItems';
import { toast } from 'sonner';

interface Props { storeId: string; }

export function InventoryControl({ storeId }: Props) {
  const { items, loading, refetch } = useMenuItems(storeId);
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { stock: string; low: string; track: boolean }>>({});

  const getDraft = (id: string) => {
    if (drafts[id]) return drafts[id];
    const item: any = items.find((i) => i.id === id);
    return {
      stock: item?.stock_count?.toString() ?? '',
      low: item?.low_stock_threshold?.toString() ?? '5',
      track: item?.track_inventory ?? false,
    };
  };

  const update = (id: string, patch: Partial<{ stock: string; low: string; track: boolean }>) => {
    setDrafts((p) => ({ ...p, [id]: { ...getDraft(id), ...patch } }));
  };

  const save = async (id: string) => {
    const d = getDraft(id);
    setSaving(id);
    const { error } = await supabase
      .from('menu_items')
      .update({
        track_inventory: d.track,
        stock_count: d.stock === '' ? null : Number(d.stock),
        low_stock_threshold: d.low === '' ? null : Number(d.low),
      } as any)
      .eq('id', id);
    setSaving(null);
    if (error) toast.error('Αποτυχία αποθήκευσης');
    else {
      toast.success('Αποθηκεύτηκε');
      setDrafts((p) => { const n = { ...p }; delete n[id]; return n; });
      refetch();
    }
  };

  if (loading) return <div className="text-center py-8 text-muted-foreground font-heading">Φόρτωση...</div>;

  const trackedItems = items.filter((i: any) => i.track_inventory);
  const lowStock = trackedItems.filter(
    (i: any) => i.stock_count !== null && i.stock_count <= (i.low_stock_threshold ?? 5),
  );
  const outOfStock = trackedItems.filter((i: any) => i.stock_count === 0);

  return (
    <div className="space-y-4">
      {(lowStock.length > 0 || outOfStock.length > 0) && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-heading font-bold text-sm text-foreground">Ειδοποιήσεις Αποθέματος</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {outOfStock.length > 0 && <span className="text-destructive font-semibold">{outOfStock.length} εξαντλημένα</span>}
                {outOfStock.length > 0 && lowStock.length > 0 && <span> · </span>}
                {lowStock.length > 0 && <span className="text-warning font-semibold">{lowStock.length} χαμηλό απόθεμα</span>}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items.map((item: any) => {
          const d = getDraft(item.id);
          const dirty = !!drafts[item.id];
          const stockNum = d.stock === '' ? null : Number(d.stock);
          const lowNum = d.low === '' ? 5 : Number(d.low);
          const isLow = d.track && stockNum !== null && stockNum > 0 && stockNum <= lowNum;
          const isOut = d.track && stockNum === 0;

          return (
            <Card key={item.id} className={`shadow-[var(--shadow-sm)] ${isOut ? 'border-destructive/40' : isLow ? 'border-warning/40' : ''}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-semibold text-foreground text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">€{Number(item.price).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isOut && <Badge variant="destructive" className="text-[10px]">Εξαντλημένο</Badge>}
                    {isLow && <Badge variant="outline" className="text-warning border-warning/30 text-[10px]">Χαμηλό</Badge>}
                    <Switch
                      checked={d.track}
                      onCheckedChange={(c) => update(item.id, { track: c })}
                    />
                  </div>
                </div>
                {d.track && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Απόθεμα</Label>
                      <Input
                        type="number"
                        min="0"
                        value={d.stock}
                        onChange={(e) => update(item.id, { stock: e.target.value })}
                        placeholder="—"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Όριο χαμηλού</Label>
                      <Input
                        type="number"
                        min="0"
                        value={d.low}
                        onChange={(e) => update(item.id, { low: e.target.value })}
                        placeholder="5"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                )}
                {dirty && (
                  <Button
                    size="sm"
                    onClick={() => save(item.id)}
                    disabled={saving === item.id}
                    className="w-full mt-2 h-8 gradient-primary text-primary-foreground"
                  >
                    <Save className="h-3 w-3 mr-1" />
                    {saving === item.id ? 'Αποθήκευση...' : 'Αποθήκευση'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="font-heading text-sm">Δεν υπάρχουν προϊόντα</p>
          </div>
        )}
      </div>
    </div>
  );
}
