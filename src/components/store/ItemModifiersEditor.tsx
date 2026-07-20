import { useEffect, useState } from 'react';
import { Plus, Trash2, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Modifier {
  id: string;
  menu_item_id: string;
  group_name: string;
  option_name: string;
  price_delta: number;
  is_required: boolean;
  is_multi: boolean;
}

export default function ItemModifiersEditor({ menuItemId, itemName }: { menuItemId: string; itemName: string }) {
  const [open, setOpen] = useState(false);
  const [mods, setMods] = useState<Modifier[]>([]);
  const [groupName, setGroupName] = useState('Extras');
  const [optionName, setOptionName] = useState('');
  const [priceDelta, setPriceDelta] = useState('0');
  const [isRequired, setIsRequired] = useState(false);
  const [isMulti, setIsMulti] = useState(true);

  const load = async () => {
    const { data } = await (supabase as any)
      .from('menu_item_modifiers')
      .select('*')
      .eq('menu_item_id', menuItemId)
      .order('sort_order', { ascending: true });
    setMods(data ?? []);
  };

  useEffect(() => { if (open) load(); }, [open, menuItemId]);

  const add = async () => {
    if (!optionName.trim()) return;
    const { error } = await (supabase as any).from('menu_item_modifiers').insert({
      menu_item_id: menuItemId,
      group_name: groupName,
      option_name: optionName,
      price_delta: Number(priceDelta) || 0,
      is_required: isRequired,
      is_multi: isMulti,
    });
    if (error) toast.error('Αποτυχία');
    else {
      toast.success('Προστέθηκε');
      setOptionName('');
      load();
    }
  };

  const remove = async (id: string) => {
    await (supabase as any).from('menu_item_modifiers').delete().eq('id', id);
    load();
  };

  const grouped: Record<string, Modifier[]> = {};
  mods.forEach(m => { (grouped[m.group_name] ??= []).push(m); });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Settings2 className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Επιλογές για {itemName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-60 overflow-y-auto">
          {Object.entries(grouped).map(([g, items]) => (
            <div key={g} className="space-y-1">
              <p className="text-xs font-heading font-bold text-muted-foreground uppercase">{g}</p>
              {items.map(m => (
                <div key={m.id} className="flex items-center justify-between bg-muted/50 rounded-lg p-2">
                  <div className="text-sm">
                    <span className="font-heading">{m.option_name}</span>
                    {m.price_delta !== 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.price_delta > 0 ? '+' : ''}€{Number(m.price_delta).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => remove(m.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ))}
          {mods.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Δεν υπάρχουν επιλογές</p>}
        </div>

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-heading font-bold text-muted-foreground uppercase">Νέα επιλογή</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Ομάδα</Label>
              <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="π.χ. Μέγεθος" />
            </div>
            <div>
              <Label className="text-xs">Όνομα</Label>
              <Input value={optionName} onChange={e => setOptionName(e.target.value)} placeholder="π.χ. Μεγάλο" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Πρόσθετο κόστος (€)</Label>
            <Input type="number" step="0.10" value={priceDelta} onChange={e => setPriceDelta(e.target.value)} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Υποχρεωτικό</span>
            <Switch checked={isRequired} onCheckedChange={setIsRequired} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Πολλαπλή επιλογή</span>
            <Switch checked={isMulti} onCheckedChange={setIsMulti} />
          </div>
          <Button onClick={add} className="w-full"><Plus className="h-4 w-4 mr-1" /> Προσθήκη</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
