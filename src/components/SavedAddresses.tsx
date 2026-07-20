import { useState, useEffect, useCallback } from 'react';
import { Home, Briefcase, MapPin, Star, Plus, X, Pencil, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

interface SavedAddressesProps {
  onSelect: (address: string, lat?: number, lon?: number) => void;
  currentAddress?: string;
}

const labelIcons: Record<string, typeof Home> = {
  'Σπίτι': Home,
  'Δουλειά': Briefcase,
  Home: Home,
  Work: Briefcase,
};

export function SavedAddresses({ onSelect, currentAddress }: SavedAddressesProps) {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSave, setShowSave] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Σπίτι');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const fetchAddresses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('saved_addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    setAddresses((data ?? []) as SavedAddress[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAddresses(); }, [fetchAddresses]);

  const handleSave = async () => {
    if (!user || !currentAddress?.trim()) {
      toast.error('Εισάγετε πρώτα μια διεύθυνση');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('saved_addresses')
      .insert({
        user_id: user.id,
        label: saveLabel,
        address: currentAddress,
      } as any);
    if (error) {
      toast.error('Αποτυχία αποθήκευσης διεύθυνσης');
    } else {
      toast.success('Η διεύθυνση αποθηκεύτηκε!');
      setShowSave(false);
      fetchAddresses();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('saved_addresses').delete().eq('id', id);
    if (!error) {
      toast.success('Η διεύθυνση αφαιρέθηκε');
      fetchAddresses();
    }
  };

  const handleSetDefault = async (id: string) => {
    if (!user) return;
    await supabase.from('saved_addresses').update({ is_default: false } as any).eq('user_id', user.id);
    await supabase.from('saved_addresses').update({ is_default: true } as any).eq('id', id);
    toast.success('Η προεπιλεγμένη διεύθυνση ενημερώθηκε');
    fetchAddresses();
  };

  const handleUpdateLabel = async (id: string) => {
    if (!editLabel.trim()) return;
    await supabase.from('saved_addresses').update({ label: editLabel } as any).eq('id', id);
    setEditId(null);
    fetchAddresses();
  };

  if (!user || loading) return null;

  const canSave = currentAddress?.trim() &&
    !addresses.some(a => a.address.toLowerCase() === currentAddress.toLowerCase());

  return (
    <div className="space-y-2">
      {addresses.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-heading">Αποθηκευμένες διευθύνσεις</p>
          {addresses.map(addr => {
            const Icon = labelIcons[addr.label] ?? MapPin;
            const isSelected = currentAddress === addr.address;
            return (
              <div
                key={addr.id}
                className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30 hover:bg-accent/50'
                }`}
              >
                <button
                  onClick={() => onSelect(addr.address, addr.latitude ?? undefined, addr.longitude ?? undefined)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'gradient-primary' : 'bg-muted'
                  }`}>
                    <Icon className={`h-4 w-4 ${isSelected ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {editId === addr.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          className="h-6 text-xs py-0 px-1"
                          maxLength={20}
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && handleUpdateLabel(addr.id)}
                        />
                        <button onClick={() => handleUpdateLabel(addr.id)}>
                          <Check className="h-3.5 w-3.5 text-success" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-heading font-semibold text-xs text-foreground">{addr.label}</span>
                        {addr.is_default && <Star className="h-3 w-3 fill-warning text-warning" />}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground truncate">{addr.address}</p>
                  </div>
                </button>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setEditId(addr.id); setEditLabel(addr.label); }}
                    className="h-6 w-6 rounded-full hover:bg-muted flex items-center justify-center"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                  {!addr.is_default && (
                    <button
                      onClick={e => { e.stopPropagation(); handleSetDefault(addr.id); }}
                      className="h-6 w-6 rounded-full hover:bg-muted flex items-center justify-center"
                      title="Ορισμός ως προεπιλογή"
                    >
                      <Star className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(addr.id); }}
                    className="h-6 w-6 rounded-full hover:bg-muted flex items-center justify-center"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canSave && (
        showSave ? (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <select
              value={saveLabel}
              onChange={e => setSaveLabel(e.target.value)}
              className="text-xs bg-background border border-border rounded px-2 py-1 font-heading"
            >
              <option value="Σπίτι">🏠 Σπίτι</option>
              <option value="Δουλειά">💼 Δουλειά</option>
              <option value="Άλλο">📍 Άλλο</option>
            </select>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs font-heading gradient-primary text-primary-foreground">
              {saving ? '...' : 'Αποθήκευση'}
            </Button>
            <button onClick={() => setShowSave(false)} className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSave(true)}
            className="flex items-center gap-1.5 text-xs text-primary font-heading hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Αποθήκευση αυτής της διεύθυνσης
          </button>
        )
      )}
    </div>
  );
}
