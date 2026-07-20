import { useState } from 'react';
import { Moon, X, Search, Plus, CheckSquare, Square } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useMenuItems } from '@/hooks/useMenuItems';
import ItemModifiersEditor from './ItemModifiersEditor';

interface MenuControlProps {
  storeId: string;
}

export function MenuControl({ storeId }: MenuControlProps) {
  const { items, loading, toggleAvailable, toggleSnooze, bulkSetSnooze, bulkSetAvailable, addItem } = useMenuItems(storeId);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newItem, setNewItem] = useState({ name: '', price: '', category: '', description: '' });

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const runBulk = async (fn: () => Promise<void>) => {
    await fn();
    exitSelectMode();
  };

  const handleAdd = async () => {
    if (!newItem.name || !newItem.price || !newItem.category) return;
    await addItem({
      name: newItem.name,
      price: parseFloat(newItem.price),
      category: newItem.category,
      description: newItem.description || undefined,
    });
    setNewItem({ name: '', price: '', category: '', description: '' });
    setAddOpen(false);
  };

  const filtered = items.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    (item.category ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const categories = [...new Set(filtered.map(i => i.category ?? 'Χωρίς Κατηγορία'))];

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground font-heading">Φόρτωση μενού...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Αναζήτηση προϊόντων..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={selectMode ? 'default' : 'outline'}
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          className="font-heading flex-shrink-0"
        >
          {selectMode ? <CheckSquare className="h-4 w-4 mr-1" /> : <Square className="h-4 w-4 mr-1" />}
          <span className="hidden sm:inline">{selectMode ? 'Άκυρο' : 'Επιλογή'}</span>
        </Button>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-primary text-primary-foreground shadow-primary flex-shrink-0">
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Προσθήκη</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">Προσθήκη Προϊόντος</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="font-heading">Όνομα</Label>
                <Input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} placeholder="Όνομα προϊόντος" maxLength={100} />
              </div>
              <div>
                <Label className="font-heading">Τιμή</Label>
                <Input type="number" step="0.01" min="0" value={newItem.price} onChange={e => setNewItem(p => ({ ...p, price: e.target.value }))} placeholder="0.00" />
              </div>
              <div>
                <Label className="font-heading">Κατηγορία</Label>
                <Input value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))} placeholder="π.χ. Πίτσα, Ποτά" maxLength={50} />
              </div>
              <div>
                <Label className="font-heading">Περιγραφή (προαιρετικό)</Label>
                <Input value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))} placeholder="Σύντομη περιγραφή" maxLength={200} />
              </div>
              <Button onClick={handleAdd} className="w-full gradient-primary text-primary-foreground font-heading" disabled={!newItem.name || !newItem.price || !newItem.category}>
                Προσθήκη
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {selectMode && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-primary/5 border border-primary/30">
          <span className="text-sm font-heading font-semibold">{selectedIds.size} επιλεγμένα</span>
          <div className="flex flex-wrap gap-2 ml-auto">
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set(filtered.map(i => i.id)))}>
              Όλα
            </Button>
            <Button size="sm" variant="outline" disabled={selectedIds.size === 0}
              onClick={() => runBulk(() => bulkSetSnooze(Array.from(selectedIds), true))}>
              <Moon className="h-3.5 w-3.5 mr-1" /> Παύση
            </Button>
            <Button size="sm" variant="outline" disabled={selectedIds.size === 0}
              onClick={() => runBulk(() => bulkSetSnooze(Array.from(selectedIds), false))}>
              Επανενεργοποίηση
            </Button>
            <Button size="sm" variant="destructive" disabled={selectedIds.size === 0}
              onClick={() => runBulk(() => bulkSetAvailable(Array.from(selectedIds), false))}>
              <X className="h-3.5 w-3.5 mr-1" /> Εξαντλήθηκαν
            </Button>
            <Button size="sm" disabled={selectedIds.size === 0}
              onClick={() => runBulk(() => bulkSetAvailable(Array.from(selectedIds), true))}>
              Διαθέσιμα
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-heading text-foreground">Δεν υπάρχουν προϊόντα</p>
          <p className="text-sm text-muted-foreground mt-1">Προσθέστε το πρώτο σας προϊόν για να ξεκινήσετε</p>
        </div>
      ) : (
        categories.map(category => (
          <div key={category}>
            <h3 className="font-heading font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-2">
              {category}
            </h3>
            <div className="space-y-2">
              {filtered.filter(i => (i.category ?? 'Χωρίς Κατηγορία') === category).map(item => (
                <Card key={item.id} className={`shadow-[var(--shadow-sm)] ${
                  !item.is_available ? 'opacity-50' : item.is_snoozed ? 'border-warning/40' : ''
                } ${selectMode && selectedIds.has(item.id) ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="p-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                    {selectMode && (
                      <Checkbox
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={() => toggleSelected(item.id)}
                        className="flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0 basis-[60%]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-heading font-semibold text-foreground truncate">{item.name}</span>
                        {item.is_snoozed && (
                          <Badge variant="outline" className="text-warning border-warning/30 text-xs">
                            <Moon className="h-3 w-3 mr-1" />
                            Παύση
                          </Badge>
                        )}
                        {!item.is_available && (
                          <Badge variant="destructive" className="text-xs">
                            <X className="h-3 w-3 mr-1" />
                            Εξαντλήθηκε
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">€{Number(item.price).toFixed(2)}</span>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                      {item.is_available && (
                        <button
                          onClick={() => toggleSnooze(item.id)}
                          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
                            item.is_snoozed
                              ? 'bg-warning/10 text-warning'
                              : 'bg-muted text-muted-foreground hover:text-warning'
                          }`}
                          title="Παύση προϊόντος"
                          aria-label="Παύση"
                        >
                          <Moon className="h-4 w-4" />
                        </button>
                      )}
                      <ItemModifiersEditor menuItemId={item.id} itemName={item.name} />
                      <Switch
                        checked={item.is_available ?? true}
                        onCheckedChange={() => toggleAvailable(item.id)}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
