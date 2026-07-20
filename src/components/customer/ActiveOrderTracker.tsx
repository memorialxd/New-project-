import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bike, ChevronRight, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface ActiveOrder {
  id: string;
  status: string;
  store_name?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  placed: 'Σε αναμονή επιβεβαίωσης',
  accepted: 'Έγινε δεκτή',
  preparing: 'Ετοιμάζεται',
  ready: 'Έτοιμη για παραλαβή',
  picked_up: 'Ο οδηγός είναι καθ’ οδόν',
  arrived: 'Ο οδηγός έφτασε',
};

const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'picked_up', 'arrived'];

/**
 * Persistent banner shown to the customer while they have an in-flight order.
 * Tapping it deep-links to the live tracking screen.
 */
export function ActiveOrderTracker() {
  const { user } = useAuth();
  const [order, setOrder] = useState<ActiveOrder | null>(null);

  useEffect(() => {
    if (!user) { setOrder(null); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await (supabase as any)
        .from('orders')
        .select('id, status, stores(name)')
        .eq('customer_id', user.id)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setOrder(data ? { id: data.id, status: data.status, store_name: data.stores?.name } : null);
    };
    load();
    const ch = supabase
      .channel(`customer-active-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user]);

  if (!order) return null;

  return (
    <Link
      to={`/order-tracking/${order.id}`}
      className="block mx-5 mt-3 rounded-2xl bg-[hsl(var(--c-accent))] text-white px-4 py-3 shadow-[0_8px_22px_-8px_hsl(var(--c-accent)/0.55)] active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          {['picked_up', 'arrived'].includes(order.status)
            ? <Bike className="h-5 w-5" strokeWidth={2.5} />
            : <MapPin className="h-5 w-5" strokeWidth={2.5} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] font-extrabold opacity-80 leading-none">
            Ενεργή παραγγελία
          </p>
          <p className="text-[14px] font-extrabold leading-tight mt-1 truncate">
            {STATUS_LABEL[order.status] ?? 'Σε εξέλιξη'}
          </p>
          {order.store_name && (
            <p className="text-[11px] opacity-85 truncate leading-tight">{order.store_name}</p>
          )}
        </div>
        <ChevronRight className="h-5 w-5 opacity-80 shrink-0" strokeWidth={2.5} />
      </div>
    </Link>
  );
}
