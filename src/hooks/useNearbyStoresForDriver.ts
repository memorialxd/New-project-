import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface NearbyStore {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  image_url: string | null;
  pendingOrders: number;
}

const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready'] as const;

/**
 * Loads active stores + their pending order counts.
 * Returns empty array when feature is disabled by admin.
 */
export function useNearbyStoresForDriver() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stores, setStores] = useState<NearbyStore[]>([]);

  // Load admin toggle + subscribe to changes
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await (supabase as any).rpc('get_platform_settings_public');
      const row = Array.isArray(data) ? data[0] : data;
      if (mounted) {
        setEnabled(Boolean(row?.show_stores_on_driver_map ?? true));
      }
    };
    load();
    const ch = supabase
      .channel('platform-settings-driver-map')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'platform_settings', filter: 'id=eq.1' },
        (payload) => {
          const v = (payload.new as { show_stores_on_driver_map?: boolean }).show_stores_on_driver_map;
          setEnabled(Boolean(v ?? true));
        }
      )
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Fetch stores + their active order counts
  useEffect(() => {
    if (enabled === false) { setStores([]); return; }
    if (enabled === null) return;

    let mounted = true;
    let validStoreIds: string[] = [];
    let validStores: NearbyStore[] = [];
    let countsRefresh: ReturnType<typeof setTimeout> | null = null;

    const IOANNINA_LAT = 39.6650;
    const IOANNINA_LNG = 20.8537;
    const MAX_KM = 15;
    const distKm = (lat: number, lng: number) => {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat - IOANNINA_LAT);
      const dLng = toRad(lng - IOANNINA_LNG);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(IOANNINA_LAT)) * Math.cos(toRad(lat)) * Math.sin(dLng/2)**2;
      return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    const applyCounts = (counts: Record<string, number>) => {
      if (!mounted) return;
      setStores(validStores.map(s => ({ ...s, pendingOrders: counts[s.id] ?? 0 })));
    };

    const refreshCounts = async () => {
      if (!mounted || validStoreIds.length === 0) return;
      const { data: orderRows } = await supabase
        .from('orders')
        .select('store_id')
        .in('status', [...ACTIVE_STATUSES])
        .in('store_id', validStoreIds);
      const counts: Record<string, number> = {};
      (orderRows ?? []).forEach(o => { counts[o.store_id] = (counts[o.store_id] ?? 0) + 1; });
      applyCounts(counts);
    };

    const scheduleRefresh = () => {
      if (countsRefresh) return;
      countsRefresh = setTimeout(() => { countsRefresh = null; refreshCounts(); }, 1500);
    };

    // Load stores once (rarely change), then counts
    (async () => {
      const { data: storeRows } = await supabase
        .from('stores')
        .select('id, name, latitude, longitude, image_url')
        .eq('is_active', true);
      if (!storeRows || !mounted) return;
      validStores = storeRows
        .filter(s => s.latitude != null && s.longitude != null &&
          distKm(s.latitude as number, s.longitude as number) <= MAX_KM)
        .map(s => ({
          id: s.id,
          name: s.name,
          latitude: s.latitude as number,
          longitude: s.longitude as number,
          image_url: s.image_url ?? null,
          pendingOrders: 0,
        }));
      validStoreIds = validStores.map(s => s.id);
      setStores(validStores);
      refreshCounts();
    })();

    // Refresh counts on order status changes (debounced)
    const ch = supabase
      .channel('driver-map-store-orders')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        () => scheduleRefresh()
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        () => scheduleRefresh()
      )
      .subscribe();

    const interval = setInterval(refreshCounts, 60_000);

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
      clearInterval(interval);
      if (countsRefresh) clearTimeout(countsRefresh);
    };
  }, [enabled]);

  return { stores, enabled: enabled ?? true };
}
