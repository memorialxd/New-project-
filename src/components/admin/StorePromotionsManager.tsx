import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Sparkles, Check, X, Clock } from 'lucide-react';
import { format } from 'date-fns';

type Row = {
  id: string;
  name: string;
  image_url: string | null;
  promotion_status: string;
  promotion_starts_at: string | null;
  promotion_ends_at: string | null;
  promotion_amount_paid: number;
  promotion_requested_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  none: 'Καμία',
  requested: 'Εκκρεμεί',
  active: 'Ενεργή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
};

const STATUS_BADGE: Record<string, string> = {
  none: 'bg-muted text-muted-foreground',
  requested: 'bg-warning/15 text-warning border border-warning/30',
  active: 'bg-success/15 text-success border border-success/30',
  rejected: 'bg-destructive/15 text-destructive border border-destructive/30',
  expired: 'bg-muted text-muted-foreground',
};

export function StorePromotionsManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, image_url, promotion_status, promotion_starts_at, promotion_ends_at, promotion_amount_paid, promotion_requested_at')
      .order('promotion_status', { ascending: true })
      .order('name');
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (storeId: string, status: 'active' | 'rejected' | 'none', extraDays?: number) => {
    const { error } = await (supabase as any).rpc('admin_set_store_promotion', {
      p_store_id: storeId,
      p_status: status,
      p_days: extraDays ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success(`Κατάσταση: ${STATUS_LABEL[status]}`);
    load();
  };

  const pending = rows.filter(r => r.promotion_status === 'requested');
  const active = rows.filter(r => r.promotion_status === 'active');
  const others = rows.filter(r => !['requested', 'active'].includes(r.promotion_status));

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Φόρτωση...</div>;
  }

  const renderRow = (r: Row) => (
    <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
      <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
        {r.image_url
          ? <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" />
          : <Sparkles className="h-5 w-5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{r.name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${STATUS_BADGE[r.promotion_status]}`}>
            {STATUS_LABEL[r.promotion_status]}
          </span>
          {r.promotion_amount_paid > 0 && (
            <span className="text-[11px] text-muted-foreground">€{Number(r.promotion_amount_paid).toFixed(2)}</span>
          )}
          {r.promotion_ends_at && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              έως {format(new Date(r.promotion_ends_at), 'dd MMM HH:mm')}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Input
          type="number"
          min={1}
          max={90}
          placeholder="ημέρες"
          value={days[r.id] ?? ''}
          onChange={e => setDays(prev => ({ ...prev, [r.id]: e.target.value }))}
          className="h-8 w-20 text-xs"
        />
        {r.promotion_status === 'requested' && (
          <>
            <Button size="sm" variant="default" onClick={() => setStatus(r.id, 'active', Number(days[r.id]) || 7)}>
              <Check className="h-3.5 w-3.5 mr-1" /> Έγκριση
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStatus(r.id, 'rejected')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {r.promotion_status === 'active' && (
          <>
            <Button size="sm" variant="outline" onClick={() => setStatus(r.id, 'active', Number(days[r.id]) || 7)}>
              Παράταση
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStatus(r.id, 'none')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {(r.promotion_status === 'none' || r.promotion_status === 'rejected' || r.promotion_status === 'expired') && (
          <Button size="sm" variant="outline" onClick={() => setStatus(r.id, 'active', Number(days[r.id]) || 7)}>
            Ενεργοποίηση
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-heading font-bold text-xl flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-warning" /> Προωθήσεις (Most Popular)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Καταστήματα που έχουν πληρώσει για να εμφανίζονται στο "🔥 Most Popular" της εφαρμογής πελάτη. Μόνο τα <strong>Ενεργά</strong> εμφανίζονται.
        </p>
      </div>

      {pending.length > 0 && (
        <section>
          <h3 className="font-semibold text-sm text-warning mb-2">Εκκρεμή αιτήματα ({pending.length})</h3>
          <div className="space-y-2">{pending.map(renderRow)}</div>
        </section>
      )}

      <section>
        <h3 className="font-semibold text-sm text-success mb-2">Ενεργές προωθήσεις ({active.length})</h3>
        {active.length === 0
          ? <p className="text-sm text-muted-foreground">Καμία ενεργή προώθηση.</p>
          : <div className="space-y-2">{active.map(renderRow)}</div>}
      </section>

      <section>
        <h3 className="font-semibold text-sm text-muted-foreground mb-2">Άλλα καταστήματα</h3>
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
          {others.map(renderRow)}
        </div>
      </section>
    </div>
  );
}

export default StorePromotionsManager;
