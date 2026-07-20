import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Bike, AlertTriangle, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Driver supply vs demand — DoorDash-style.
 * Shows online drivers, live orders needing dispatch, supply ratio,
 * and per-zone breakdown when demand_zones exist.
 */
export default function DriverSupplyPanel() {
  const { data } = useQuery({
    queryKey: ['driver-supply'],
    refetchInterval: 20_000,
    queryFn: async () => {
      const [statesRes, ordersRes, zonesRes] = await Promise.all([
        supabase.from('driver_state').select('driver_id, shift_started_at, on_break'),
        supabase.from('orders')
          .select('id, status, driver_id, delivery_latitude, delivery_longitude')
          .in('status', ['placed', 'accepted', 'preparing', 'ready']),
        (supabase as any).from('demand_zones').select('id, name, latitude, longitude, radius_km, driver_count, order_count, is_active').eq('is_active', true),
      ]);
      const states = statesRes.data ?? [];
      const orders = ordersRes.data ?? [];
      const zones = (zonesRes.data ?? []) as any[];
      const online = states.filter((s: any) => !!s.shift_started_at && !s.on_break).length;
      const onBreak = states.filter((s: any) => s.on_break).length;
      const liveOrders = orders.length;
      const unassigned = orders.filter((o: any) => !o.driver_id).length;
      // simple needed = ceil(liveOrders / 3) — one driver per ~3 concurrent orders
      const needed = Math.max(1, Math.ceil(liveOrders / 3));
      const ratio = needed === 0 ? 1 : online / needed;
      return { online, onBreak, liveOrders, unassigned, needed, ratio, zones };
    },
  });

  if (!data) return null;
  const supplyHealthy = data.ratio >= 1;
  const supplyTone = supplyHealthy ? 'text-success' : data.ratio >= 0.6 ? 'text-warning' : 'text-destructive';

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Supply vs Demand</h3>
        </div>
        {!supplyHealthy && (
          <Badge variant="destructive" className="h-5 text-[10px] gap-1">
            <AlertTriangle className="h-3 w-3" />
            Λίγοι οδηγοί
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SupplyStat label="Online" value={data.online} icon={Bike} tone="text-success" />
        <SupplyStat label="Σε διάλειμμα" value={data.onBreak} icon={Users} tone="text-warning" />
        <SupplyStat label="Live παραγγελίες" value={data.liveOrders} icon={TrendingUp} tone="text-primary" />
      </div>

      <div className="rounded-lg bg-muted/50 p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground">Supply ratio</span>
          <span className={cn('text-[12px] font-bold tabular-nums', supplyTone)}>
            {data.online} / {data.needed}
          </span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              supplyHealthy ? 'bg-success' : data.ratio >= 0.6 ? 'bg-warning' : 'bg-destructive',
            )}
            style={{ width: `${Math.min(data.ratio * 100, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {supplyHealthy
            ? 'Επαρκής κάλυψη'
            : data.ratio >= 0.6
            ? 'Σκέψου να ενεργοποιήσεις surge ή quest'
            : 'Κρίσιμη έλλειψη — ενεργοποίησε surge'}
        </p>
      </div>

      {data.zones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Hot zones</p>
          {data.zones.slice(0, 5).map((z) => {
            const dc = z.driver_count ?? 0;
            const oc = z.order_count ?? 0;
            const hot = oc > dc;
            return (
              <div key={z.id} className="flex items-center justify-between text-[11.5px] px-2 py-1.5 rounded bg-muted/30">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={cn('h-1.5 w-1.5 rounded-full', hot ? 'bg-destructive animate-pulse' : 'bg-success')} />
                  <span className="truncate font-medium">{z.name}</span>
                </div>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {dc} drv / {oc} ord
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SupplyStat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2 text-center">
      <Icon className={cn('h-3.5 w-3.5 mx-auto mb-0.5', tone)} />
      <p className="text-base font-bold tabular-nums leading-none">{value}</p>
      <p className="text-[9.5px] text-muted-foreground mt-0.5 truncate">{label}</p>
    </div>
  );
}
