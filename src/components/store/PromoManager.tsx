import { useState, useEffect, useCallback } from 'react';
import { Plus, Tag, Trash2, ToggleLeft, ToggleRight, Pencil, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type PromoRow = Database['public']['Tables']['promo_codes']['Row'];

interface PromoManagerProps {
  storeId: string;
}

const emptyForm = {
  code: '',
  discount_type: 'percentage' as 'percentage' | 'fixed',
  discount_value: '',
  min_order_amount: '',
  max_uses: '',
  expires_at: '',
};

export function PromoManager({ storeId }: PromoManagerProps) {
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchPromos = useCallback(async () => {
    const { data } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });
    setPromos((data ?? []) as PromoRow[]);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { fetchPromos(); }, [fetchPromos]);

  const resetForm = () => {
    setForm(emptyForm);
    setShowForm(false);
    setEditId(null);
  };

  const startEdit = (promo: PromoRow) => {
    setForm({
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: String(promo.discount_value),
      min_order_amount: Number(promo.min_order_amount) > 0 ? String(promo.min_order_amount) : '',
      max_uses: promo.max_uses ? String(promo.max_uses) : '',
      expires_at: promo.expires_at ? promo.expires_at.slice(0, 16) : '',
    });
    setEditId(promo.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.discount_value) {
      toast.error('Ο κωδικός και η αξία έκπτωσης είναι υποχρεωτικά');
      return;
    }
    const value = parseFloat(form.discount_value);
    if (isNaN(value) || value <= 0) {
      toast.error('Εισάγετε έγκυρη αξία έκπτωσης');
      return;
    }
    if (form.discount_type === 'percentage' && value > 100) {
      toast.error('Το ποσοστό δεν μπορεί να υπερβαίνει το 100');
      return;
    }

    setSaving(true);
    const payload = {
      code: form.code.trim().toUpperCase(),
      discount_type: form.discount_type as any,
      discount_value: value,
      min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : 0,
      max_uses: form.max_uses ? parseInt(form.max_uses) : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      store_id: storeId,
    };

    if (editId) {
      const { error } = await supabase
        .from('promo_codes')
        .update(payload)
        .eq('id', editId);
      if (error) {
        toast.error(error.message.includes('idx_promo_codes_code') ? 'Ο κωδικός υπάρχει ήδη' : 'Αποτυχία ενημέρωσης');
      } else {
        toast.success('Ο κωδικός προσφοράς ενημερώθηκε');
        resetForm();
        fetchPromos();
      }
    } else {
      const { error } = await supabase
        .from('promo_codes')
        .insert(payload);
      if (error) {
        toast.error(error.message.includes('idx_promo_codes_code') ? 'Ο κωδικός υπάρχει ήδη' : 'Αποτυχία δημιουργίας');
      } else {
        toast.success('Κωδικός προσφοράς δημιουργήθηκε! 🎉');
        resetForm();
        fetchPromos();
      }
    }
    setSaving(false);
  };

  const toggleActive = async (promo: PromoRow) => {
    const { error } = await supabase
      .from('promo_codes')
      .update({ is_active: !promo.is_active })
      .eq('id', promo.id);
    if (!error) {
      toast.success(promo.is_active ? 'Προσφορά απενεργοποιήθηκε' : 'Προσφορά ενεργοποιήθηκε');
      fetchPromos();
    }
  };

  const isExpired = (promo: PromoRow) =>
    promo.expires_at && new Date(promo.expires_at) < new Date();

  const isMaxedOut = (promo: PromoRow) =>
    promo.max_uses !== null && promo.current_uses >= promo.max_uses;

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground font-heading">Φόρτωση προσφορών...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showForm ? (
        <Card className="shadow-[var(--shadow-md)] border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="font-heading text-lg">{editId ? 'Επεξεργασία Προσφοράς' : 'Νέος Κωδικός Προσφοράς'}</CardTitle>
              <button onClick={resetForm} className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="font-heading text-sm">Κωδικός</Label>
              <Input
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="π.χ. WELCOME10"
                className="font-mono uppercase"
                maxLength={30}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-heading text-sm">Τύπος</Label>
                <Select value={form.discount_type} onValueChange={v => setForm(p => ({ ...p, discount_type: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Ποσοστό (%)</SelectItem>
                    <SelectItem value="fixed">Σταθερό (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="font-heading text-sm">Αξία</Label>
                <Input
                  type="number"
                  value={form.discount_value}
                  onChange={e => setForm(p => ({ ...p, discount_value: e.target.value }))}
                  placeholder={form.discount_type === 'percentage' ? '10' : '5.00'}
                  min="0"
                  step={form.discount_type === 'percentage' ? '1' : '0.01'}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-heading text-sm">Ελάχ. Παραγγελία (€)</Label>
                <Input
                  type="number"
                  value={form.min_order_amount}
                  onChange={e => setForm(p => ({ ...p, min_order_amount: e.target.value }))}
                  placeholder="0"
                  min="0"
                  step="0.01"
                />
              </div>
              <div>
                <Label className="font-heading text-sm">Μέγ. Χρήσεις</Label>
                <Input
                  type="number"
                  value={form.max_uses}
                  onChange={e => setForm(p => ({ ...p, max_uses: e.target.value }))}
                  placeholder="Απεριόριστο"
                  min="1"
                />
              </div>
            </div>
            <div>
              <Label className="font-heading text-sm">Λήξη (προαιρετικό)</Label>
              <Input
                type="datetime-local"
                value={form.expires_at}
                onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))}
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full gradient-primary text-primary-foreground font-heading"
            >
              {saving ? 'Αποθήκευση...' : editId ? 'Ενημέρωση' : 'Δημιουργία'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Button
          onClick={() => setShowForm(true)}
          className="w-full gradient-primary text-primary-foreground font-heading"
        >
          <Plus className="h-4 w-4 mr-2" />
          Δημιουργία Κωδικού Προσφοράς
        </Button>
      )}

      {promos.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="font-heading text-foreground">Δεν υπάρχουν κωδικοί προσφοράς</p>
          <p className="text-sm text-muted-foreground mt-1">Δημιουργήστε τον πρώτο κωδικό για να προσελκύσετε πελάτες</p>
        </div>
      ) : (
        promos.map(promo => {
          const expired = isExpired(promo);
          const maxed = isMaxedOut(promo);
          return (
            <Card key={promo.id} className={`shadow-[var(--shadow-sm)] ${!promo.is_active || expired || maxed ? 'opacity-60' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono font-bold text-foreground">{promo.code}</p>
                      {!promo.is_active && <Badge variant="outline" className="text-xs">Ανενεργό</Badge>}
                      {expired && <Badge variant="outline" className="text-xs text-destructive border-destructive/30">Έληξε</Badge>}
                      {maxed && <Badge variant="outline" className="text-xs text-warning border-warning/30">Εξαντλήθηκε</Badge>}
                    </div>
                    <p className="text-sm text-primary font-heading mt-0.5">
                      {promo.discount_type === 'percentage'
                        ? `${promo.discount_value}% έκπτωση`
                        : `€${Number(promo.discount_value).toFixed(2)} έκπτωση`}
                      {Number(promo.min_order_amount) > 0 && ` • Ελάχ. €${Number(promo.min_order_amount).toFixed(2)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(promo)} className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => toggleActive(promo)} className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      {promo.is_active
                        ? <ToggleRight className="h-4 w-4 text-success" />
                        : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Χρήσεις: {promo.current_uses}{promo.max_uses ? `/${promo.max_uses}` : ''}</span>
                  {promo.expires_at && (
                    <span>Λήξη: {new Date(promo.expires_at).toLocaleDateString('el-GR')}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
