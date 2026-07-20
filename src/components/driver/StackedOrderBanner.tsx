import { useEffect, useState } from 'react';
import { Layers, MapPin, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface StackedOrderBannerProps {
  orderId: string;
}

interface BatchStop {
  id: string;
  delivery_address: string | null;
  status: string;
  stop_sequence: number | null;
}

export function StackedOrderBanner({ orderId }: StackedOrderBannerProps) {
  const [siblings, setSiblings] = useState<BatchStop[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve the batch_id of this order, then fetch every sibling in the batch.
      const { data: me } = await supabase
        .from('orders')
        .select('batch_id, stacked_with_order_id')
        .eq('id', orderId)
        .maybeSingle();

      const batchId = me?.batch_id ?? null;
      let rows: BatchStop[] = [];

      if (batchId) {
        const { data } = await supabase
          .from('orders')
          .select('id, delivery_address, status, stop_sequence')
          .eq('batch_id', batchId)
          .neq('id', orderId)
          .order('stop_sequence', { ascending: true, nullsFirst: false });
        rows = (data ?? []) as BatchStop[];
      } else if (me?.stacked_with_order_id) {
        // Legacy 1+1 fallback
        const { data } = await supabase
          .from('orders')
          .select('id, delivery_address, status, stop_sequence')
          .eq('id', me.stacked_with_order_id)
          .maybeSingle();
        if (data) rows = [data as BatchStop];
      } else {
        // Reverse lookup for legacy link
        const { data } = await supabase
          .from('orders')
          .select('id, delivery_address, status, stop_sequence')
          .eq('stacked_with_order_id', orderId);
        rows = (data ?? []) as BatchStop[];
      }

      if (!cancelled) setSiblings(rows);
    })();
  }, [orderId]);

  if (siblings.length === 0) return null;

  return (
    <div className="rounded-xl bg-primary/10 border border-primary/30 driver-glass p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
          <Layers className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-heading font-bold text-[hsl(var(--driver-text))] uppercase tracking-wide">
            Stacked διαδρομή
          </div>
          <div className="text-[10px] text-[hsl(var(--driver-text-muted))]">
            +{siblings.length} {siblings.length === 1 ? 'παράδοση' : 'παραδόσεις'} στην ίδια διαδρομή
          </div>
        </div>
        <span className="text-[10px] font-bold tabular-nums px-2 py-1 rounded-md bg-primary/20 text-primary">
          {siblings.length + 1}/3
        </span>
      </div>

      <ol className="space-y-1.5 pl-1">
        {siblings.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 h-5 w-5 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center shrink-0">
              {s.stop_sequence ?? i + 2}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 text-[hsl(var(--driver-text))] truncate">
                <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate">{s.delivery_address || 'Προορισμός'}</span>
              </div>
              <div className="text-[10px] text-[hsl(var(--driver-text-muted))] flex items-center gap-1">
                <Package className="h-3 w-3" /> {s.status}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
