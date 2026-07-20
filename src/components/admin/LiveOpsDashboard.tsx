import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';
import { escapeHtml } from '@/lib/escape-html';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Activity, Users, Store as StoreIcon, ShoppingBag, Clock, Gauge,
  CircleDollarSign, Timer, MapPin, Wifi, WifiOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { el } from 'date-fns/locale';

interface DriverLocation {
  driver_id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  updated_at: string;
}

interface DriverInfo {
  driver_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  on_break: boolean;
}

interface StoreMarker {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  is_active: boolean | null;
}

interface LiveOrder {
  id: string;
  status: string;
  driver_id: string | null;
  store_id: string;
  total_amount: number;
  created_at: string;
}

const LIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'picked_up', 'arrived'];
const STALE_MS = 30_000; // driver considered offline if no update in 30s

export default function LiveOpsDashboard() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const storeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const fitDoneRef = useRef(false);
  const { token, loading: tokenLoading } = useMapboxToken();

  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [driverInfos, setDriverInfos] = useState<Map<string, DriverInfo>>(new Map());
  const [stores, setStores] = useState<StoreMarker[]>([]);
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [now, setNow] = useState<number>(Date.now());
  const [todayDelivered, setTodayDelivered] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);

  // Static data: drivers + stores
  useEffect(() => {
    async function load() {
      const [{ data: profiles }, { data: dps }, { data: states }, { data: storesData }] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').eq('role', 'driver' as any),
        supabase.from('driver_profiles').select('user_id, driver_code, is_active' as any),
        supabase.from('driver_state').select('driver_id, on_break'),
        supabase.from('stores').select('id, name, latitude, longitude, is_active'),
      ]);

      const map = new Map<string, DriverInfo>();
      profiles?.forEach((p: any) => {
        map.set(p.user_id, {
          driver_id: p.user_id,
          name: p.full_name || p.user_id.slice(0, 8),
          code: null, is_active: false, on_break: false,
        });
      });
      (dps as any[])?.forEach((dp: any) => {
        const e = map.get(dp.user_id);
        if (e) { e.code = dp.driver_code; e.is_active = !!dp.is_active; }
      });
      (states as any[])?.forEach((s: any) => {
        const e = map.get(s.driver_id);
        if (e) e.on_break = !!s.on_break;
      });
      setDriverInfos(map);

      if (storesData) {
        setStores(storesData.filter(s => s.latitude != null && s.longitude != null) as StoreMarker[]);
      }
    }
    load();
  }, []);

  // 1-second polling for driver positions + live orders
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [{ data: locs }, { data: live }, { data: doneToday }] = await Promise.all([
        supabase.from('driver_locations').select('*'),
        supabase.from('orders')
          .select('id, status, driver_id, store_id, total_amount, created_at')
          .in('status', LIVE_STATUSES as any),
        supabase.from('orders')
          .select('total_amount')
          .eq('status', 'delivered' as any)
          .gte('created_at', todayStart.toISOString()),
      ]);
      if (cancelled) return;
      if (locs) setLocations(locs as DriverLocation[]);
      if (live) setOrders(live as LiveOrder[]);
      if (doneToday) {
        setTodayDelivered(doneToday.length);
        setTodayRevenue(doneToday.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0));
      }
      setNow(Date.now());
    }
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Init map once
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [20.8537, 39.6650],
      zoom: 12,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; fitDoneRef.current = false; };
  }, [token]);

  // Driver markers — update on every locations change (1s)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set(locations.map(l => l.driver_id));
    markersRef.current.forEach((marker, id) => {
      if (!activeIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    });

    locations.forEach(loc => {
      const info = driverInfos.get(loc.driver_id);
      const stale = now - new Date(loc.updated_at).getTime() > STALE_MS;
      const color = stale ? '#94a3b8' : info?.on_break ? '#f59e0b' : '#3b82f6';
      const existing = markersRef.current.get(loc.driver_id);

      if (existing) {
        existing.setLngLat([loc.longitude, loc.latitude]);
        const el = existing.getElement().firstElementChild as HTMLElement | null;
        if (el) el.style.background = color;
      } else {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div style="width:34px;height:34px;background:${color};border-radius:50%;border:3px solid white;box-shadow:0 2px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;transition:background 200ms;">🛵</div>`;
        const popup = new mapboxgl.Popup({ offset: 20 }).setHTML(`
          <div style="text-align:center;font-family:system-ui;padding:4px;">
            <strong>${escapeHtml(info?.name ?? loc.driver_id.slice(0, 8))}</strong>
            ${info?.code ? `<br/><span style="font-size:11px;opacity:0.7;">${escapeHtml(info.code)}</span>` : ''}
            ${loc.speed != null && loc.speed > 0 ? `<br/><span style="font-size:11px;">${(loc.speed * 3.6).toFixed(0)} km/h</span>` : ''}
          </div>
        `);
        const marker = new mapboxgl.Marker({ element: wrap })
          .setLngLat([loc.longitude, loc.latitude])
          .setPopup(popup)
          .addTo(map);
        markersRef.current.set(loc.driver_id, marker);
      }
    });
  }, [locations, driverInfos, now]);

  // Store markers — once stores load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !stores.length) return;
    storeMarkersRef.current.forEach(m => m.remove());
    storeMarkersRef.current = [];

    stores.forEach(s => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div style="width:28px;height:28px;background:${s.is_active ? '#f97316' : '#cbd5e1'};border-radius:50%;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;font-size:13px;">🏪</div>`;
      const popup = new mapboxgl.Popup({ offset: 16 }).setHTML(`
        <div style="font-family:system-ui;padding:4px;"><strong>${escapeHtml(s.name)}</strong></div>
      `);
      const m = new mapboxgl.Marker({ element: wrap })
        .setLngLat([s.longitude, s.latitude])
        .setPopup(popup)
        .addTo(map);
      storeMarkersRef.current.push(m);
    });

    if (!fitDoneRef.current) {
      const points = [
        ...stores.map(s => [s.longitude, s.latitude] as [number, number]),
        ...locations.map(l => [l.longitude, l.latitude] as [number, number]),
      ];
      if (points.length > 1) {
        const b = new mapboxgl.LngLatBounds();
        points.forEach(p => b.extend(p));
        map.fitBounds(b, { padding: 70, maxZoom: 14, duration: 0 });
        fitDoneRef.current = true;
      }
    }
  }, [stores, locations]);

  // ─── Derived stats ──────────────────────────────────
  const stats = useMemo(() => {
    const onlineDrivers = locations.filter(l => now - new Date(l.updated_at).getTime() <= STALE_MS);
    const onBreak = onlineDrivers.filter(l => driverInfos.get(l.driver_id)?.on_break).length;
    const moving = onlineDrivers.filter(l => (l.speed ?? 0) * 3.6 > 5).length;
    const idle = onlineDrivers.length - onBreak - moving;
    const avgSpeed = onlineDrivers.length
      ? (onlineDrivers.reduce((s, l) => s + Math.max(0, (l.speed ?? 0) * 3.6), 0) / onlineDrivers.length)
      : 0;

    const activeOrders = orders.length;
    const unassigned = orders.filter(o => !o.driver_id).length;
    const inDelivery = orders.filter(o => o.status === 'picked_up' || o.status === 'arrived').length;
    const inKitchen = orders.filter(o => o.status === 'preparing' || o.status === 'accepted' || o.status === 'placed').length;
    const oldest = orders.reduce<number>((m, o) => {
      const ageMin = (now - new Date(o.created_at).getTime()) / 60000;
      return Math.max(m, ageMin);
    }, 0);

    const activeStores = stores.filter(s => s.is_active).length;

    return {
      onlineDrivers: onlineDrivers.length,
      offlineDrivers: locations.length - onlineDrivers.length,
      onBreak, moving, idle, avgSpeed,
      activeOrders, unassigned, inDelivery, inKitchen, oldest,
      activeStores, totalStores: stores.length,
      todayDelivered, todayRevenue,
    };
  }, [locations, orders, driverInfos, stores, now, todayDelivered, todayRevenue]);

  // Driver activity list (top 8 most-recent)
  const liveDriverList = useMemo(() => {
    return [...locations]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 8)
      .map(l => ({
        loc: l,
        info: driverInfos.get(l.driver_id),
        ageSec: Math.round((now - new Date(l.updated_at).getTime()) / 1000),
        kmh: Math.max(0, (l.speed ?? 0) * 3.6),
      }));
  }, [locations, driverInfos, now]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-heading font-bold text-xl flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Live Operations
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Πραγματικός χρόνος · Ενημέρωση κάθε 1 δευτερόλεπτο
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </Badge>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Wifi} label="Online οδηγοί" value={stats.onlineDrivers} sub={`${stats.offlineDrivers} offline`} accent="text-green-600" />
        <StatCard icon={Gauge} label="Μέση ταχύτητα" value={`${stats.avgSpeed.toFixed(0)} km/h`} sub={`${stats.moving} κινούνται`} accent="text-blue-600" />
        <StatCard icon={Users} label="Σε διάλειμμα" value={stats.onBreak} sub={`${stats.idle} ακίνητοι`} accent="text-amber-600" />
        <StatCard icon={WifiOff} label="Stale (>30s)" value={stats.offlineDrivers} sub="χωρίς signal" accent="text-muted-foreground" />

        <StatCard icon={ShoppingBag} label="Ενεργές παραγγ." value={stats.activeOrders} sub={`${stats.unassigned} χωρίς οδηγό`} accent="text-primary" />
        <StatCard icon={Timer} label="Παλαιότερη" value={`${stats.oldest.toFixed(0)}'`} sub="λεπτά" accent="text-orange-600" />
        <StatCard icon={MapPin} label="Σε παράδοση" value={stats.inDelivery} sub={`${stats.inKitchen} στην κουζίνα`} accent="text-indigo-600" />
        <StatCard icon={StoreIcon} label="Ενεργά μαγαζιά" value={stats.activeStores} sub={`${stats.totalStores} σύνολο`} accent="text-warning" />

        <StatCard icon={CircleDollarSign} label="Έσοδα σήμερα" value={`€${stats.todayRevenue.toFixed(2)}`} sub={`${stats.todayDelivered} παραδόσεις`} accent="text-success" />
        <StatCard icon={Clock} label="Ώρα" value={new Date(now).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} sub="server sync" accent="text-muted-foreground" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Map */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" /> Θέσεις οδηγών (1s refresh)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {tokenLoading ? (
              <div className="h-[520px] flex items-center justify-center">
                <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !token ? (
              <div className="h-[520px] flex items-center justify-center text-muted-foreground text-sm">
                Mapbox token not configured
              </div>
            ) : (
              <div ref={mapContainer} className="h-[520px] w-full" />
            )}
          </CardContent>
        </Card>

        {/* Live driver list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Πιο πρόσφατα signals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {liveDriverList.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">Κανένας οδηγός online</div>
              )}
              {liveDriverList.map(({ loc, info, ageSec, kmh }) => {
                const stale = ageSec > 30;
                return (
                  <div key={loc.driver_id} className="p-3 flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${stale ? 'bg-muted' : info?.on_break ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{info?.name ?? loc.driver_id.slice(0, 8)}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        {info?.code && <span>#{info.code}</span>}
                        <span>{kmh.toFixed(0)} km/h</span>
                        {info?.on_break && <span className="text-amber-600">διάλειμμα</span>}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {ageSec < 60
                        ? `${ageSec}s πριν`
                        : formatDistanceToNow(new Date(loc.updated_at), { locale: el, addSuffix: true })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: any; label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${accent ?? ''}`} />
          {label}
        </div>
        <div className={`text-2xl font-heading font-bold mt-1 tabular-nums ${accent ?? ''}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
