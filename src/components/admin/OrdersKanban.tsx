import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Clock, AlertTriangle, MapPin, Bike, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNowStrict } from 'date-fns';
import { formatOrderNumber } from '@/lib/order-number';

/**
 * DoorDash-style orders pipeline: 5 columns (New → Preparing → Ready → In Transit → Delivered)
 * with SLA timers, late flagging, and inline driver reassignment.
 *
 * "Late" rule per column:
 *   - new (placed/accepted): > 3 min unacknowledged
 *   - preparing: now > predicted_ready_at
 *   - ready: > 5 min waiting for pickup
 *   - in_transit (picked_up/arrived): > predicted_ready_at + 25 min
 */

const COLUMNS: { id: string; label: string; statuses: string[]; tone: string; sla: string }[] = [
  { id: 'new',        label: 'Νέες',         statuses: ['placed', 'accepted'],   tone: 'text-info',     sla: '3\'' },
  { id: 'preparing',  label: 'Ετοιμάζονται', statuses: ['preparing'],            tone: 'text-warning',  sla: 'prep' },
  { id: 'ready',      label: 'Έτοιμες',      statuses: ['ready'],                tone: 'text-success',  sla: '5\'' },
  { id: 'in_transit', label: 'Σε διανομή',   statuses: ['picked_up', 'arrived'], tone: 'text-primary',  sla: '25\'' },
  { id: 'delivered',  label: 'Παραδόθηκαν',  statuses: ['delivered'],            tone: 'text-muted-foreground', sla: '' },
];

function isLate(o: any, columnId: string): boolean {
  const now = Date.now();
  const created = new Date(o.created_at).getTime();
  const predicted = o.predicted_ready_at ? new Date(o.predicted_ready_at).getTime() : null;
  if (columnId === 'new') return now - created > 3 * 60 * 1000;
  if (columnId === 'preparing') return predicted ? now > predicted : (now - created) > 20 * 60 * 1000;
  if (columnId === 'ready') {
    // time since marked ready ≈ updated_at proxy
    const ts = new Date(o.updated_at || o.created_at).getTime();
    return now - ts > 5 * 60 * 1000;
  }
  if (columnId === 'in_transit') {
    const base = predicted ?? created;
    return now - base > 25 * 60 * 1000;
  }
  return false;
}

interface OrderCardProps {
  order: any;
  columnId: string;
  drivers: { user_id: string; full_name: string | null }[];
  onAssign: (orderId: string, driverId: string) => void;
}

function OrderCard({ order, columnId, drivers, onAssign }: OrderCardProps) {
  const late = isLate(order, columnId);
  const elapsed = formatDistanceToNowStrict(new Date(order.created_at), { addSuffix: false });
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-2.5 hover:shadow-sm transition-all cursor-pointer',
        late ? 'border-destructive/60 ring-1 ring-destructive/30' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold text-foreground">{formatOrderNumber(order)}</span>
        <span className={cn('text-[10.5px] tabular-nums flex items-center gap-1', late ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
          {late && <AlertTriangle className="h-3 w-3" />}
          <Clock className="h-3 w-3" />
          {elapsed}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums text-[13px]">€{Number(order.total_amount || 0).toFixed(2)}</span>
        <Badge variant="outline" className="h-4 px-1.5 text-[9.5px] font-normal">
          {order.payment_method === 'cash' ? 'Μετρητά' : order.payment_method === 'external' ? 'Ext' : 'Κάρτα'}
        </Badge>
      </div>
      {order.delivery_address && (
        <p className="mt-1 text-[10.5px] text-muted-foreground line-clamp-1 flex items-center gap-1">
          <MapPin className="h-2.5 w-2.5 shrink-0" />
          {order.delivery_address}
        </p>
      )}
      {columnId !== 'delivered' && (
        <div className="mt-2">
          <Select
            value={order.driver_id || 'unassigned'}
            onValueChange={(v) => onAssign(order.id, v)}
          >
            <SelectTrigger className="h-6 text-[10.5px] px-1.5">
              <Bike className="h-2.5 w-2.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned" disabled>Χωρίς οδηγό</SelectItem>
              <SelectItem value="unassign">✕ Αφαίρεση</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.user_id} value={d.user_id}>
                  {d.full_name || d.user_id.slice(0, 6)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export default function OrdersKanban() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'live' | 'all'>('live');

  const { data: orders } = useQuery({
    queryKey: ['kanban-orders', statusFilter],
    refetchInterval: 15_000,
    queryFn: async () => {
      const q = supabase
        .from('orders')
        .select('id, status, driver_id, total_amount, payment_method, delivery_address, created_at, updated_at, predicted_ready_at')
        .order('created_at', { ascending: false })
        .limit(120);
      if (statusFilter === 'live') {
        q.in('status', ['placed', 'accepted', 'preparing', 'ready', 'arrived', 'picked_up']);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: drivers } = useQuery({
    queryKey: ['kanban-drivers'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('user_id, full_name').eq('role', 'driver');
      return data ?? [];
    },
  });

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const c of COLUMNS) map[c.id] = [];
    for (const o of orders ?? []) {
      const col = COLUMNS.find((c) => c.statuses.includes(o.status));
      if (col) map[col.id].push(o);
    }
    return map;
  }, [orders]);

  const handleAssign = async (orderId: string, driverId: string) => {
    const newDriver = driverId === 'unassign' ? null : driverId;
    const { error } = await supabase.from('orders').update({ driver_id: newDriver } as any).eq('id', orderId);
    if (error) toast.error('Αποτυχία ανάθεσης');
    else {
      toast.success(newDriver ? 'Ανατέθηκε σε οδηγό' : 'Αφαιρέθηκε οδηγός');
      queryClient.invalidateQueries({ queryKey: ['kanban-orders'] });
    }
  };

  const lateCount = (orders ?? []).filter((o) => {
    const col = COLUMNS.find((c) => c.statuses.includes(o.status));
    return col && isLate(o, col.id);
  }).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-lg font-bold">Παραγγελίες · Pipeline</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {orders?.length ?? 0}
          </span>
          {lateCount > 0 && (
            <Badge variant="destructive" className="h-5 text-[10px] gap-1">
              <AlertTriangle className="h-3 w-3" />
              {lateCount} καθυστερούν
            </Badge>
          )}
        </div>
        <div className="flex gap-1 p-0.5 bg-muted rounded-md">
          {(['live', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                'px-2.5 h-6 text-[11px] font-medium rounded transition-colors',
                statusFilter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {f === 'live' ? 'Ζωντανές' : 'Όλες (24h)'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {COLUMNS.map((col) => {
          const items = grouped[col.id] ?? [];
          const colLate = items.filter((o) => isLate(o, col.id)).length;
          return (
            <div key={col.id} className="rounded-xl bg-muted/40 border border-border/60 p-2 flex flex-col min-h-[200px]">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('text-[12px] font-semibold', col.tone)}>{col.label}</span>
                  <span className="text-[10.5px] text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                {colLate > 0 && (
                  <span className="text-[10px] font-semibold text-destructive flex items-center gap-0.5">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {colLate}
                  </span>
                )}
              </div>
              <div className="space-y-1.5 flex-1">
                {items.length === 0 ? (
                  <p className="text-center text-[10.5px] text-muted-foreground py-4">—</p>
                ) : (
                  items.slice(0, 30).map((o) => (
                    <OrderCard key={o.id} order={o} columnId={col.id} drivers={drivers ?? []} onAssign={handleAssign} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
