import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';
import { escapeHtml } from '@/lib/escape-html';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface StoreRow {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean | null;
  image_url: string | null;
}

const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready'];
const DEFAULT_LAT = 39.6650; // Ιωάννινα (matches driver map)
const DEFAULT_LNG = 20.8537;
const MAX_KM = 15;

function distKm(lat: number, lng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - DEFAULT_LAT);
  const dLng = toRad(lng - DEFAULT_LNG);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(DEFAULT_LAT)) * Math.cos(toRad(lat)) * Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Driver Map Editor — admin-only.
 * Shows the driver's perspective: each active store with its current
 * active-order count. Admin can click a store, then click anywhere
 * on the map to place it (saves coords). Stores without coords appear
 * at the default city center so they can be dragged into position.
 */
export default function DriverMapEditor() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const { token, loading: tokenLoading } = useMapboxToken();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});
  const [editMode, setEditMode] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  const editModeRef = useRef(true);
  const selectedRef = useRef<string | null>(null);
  const storesRef = useRef<StoreRow[]>([]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => { selectedRef.current = selectedStoreId; }, [selectedStoreId]);
  useEffect(() => { storesRef.current = stores; }, [stores]);

  // Load stores + active order counts
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [{ data: storeRows }, { data: orderRows }] = await Promise.all([
        supabase.from('stores').select('id, name, address, latitude, longitude, is_active, image_url'),
        supabase.from('orders').select('store_id').in('status', ACTIVE_STATUSES as never[]),
      ]);
      if (!mounted) return;
      const counts: Record<string, number> = {};
      (orderRows ?? []).forEach((o: { store_id: string }) => {
        counts[o.store_id] = (counts[o.store_id] ?? 0) + 1;
      });
      setOrderCounts(counts);
      // Match driver-map: only active stores; either no coords yet, or within Ioannina range
      const filtered = ((storeRows ?? []) as StoreRow[]).filter(s => {
        if (s.is_active === false) return false;
        if (s.latitude == null || s.longitude == null) return true;
        return distKm(s.latitude, s.longitude) <= MAX_KM;
      });
      setStores(filtered);
    };
    load();

    const ch = supabase
      .channel('driver-map-editor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, load)
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Init map
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [DEFAULT_LNG, DEFAULT_LAT],
      zoom: 13,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('click', async (e) => {
      if (!editModeRef.current) return;
      const id = selectedRef.current;
      if (!id) return;
      const store = storesRef.current.find(s => s.id === id);
      if (!store) return;
      const { lng, lat } = e.lngLat;
      const { error } = await supabase
        .from('stores')
        .update({ latitude: lat, longitude: lng })
        .eq('id', id);
      if (error) {
        toast.error(`Αποτυχία: ${error.message}`);
      } else {
        toast.success(`${store.name} τοποθετήθηκε`);
        setStores(prev => prev.map(s => s.id === id ? { ...s, latitude: lat, longitude: lng } : s));
        setSelectedStoreId(null);
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [token]);

  // Render markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    stores.forEach(store => {
      const lat = store.latitude ?? DEFAULT_LAT;
      const lng = store.longitude ?? DEFAULT_LNG;
      const hasCoords = store.latitude != null && store.longitude != null;
      const activeCount = orderCounts[store.id] ?? 0;
      const isSelected = selectedStoreId === store.id;
      const visibleToDrivers = (store.is_active ?? true) && activeCount > 0 && hasCoords;

      // Color: amber if visible to drivers; gray if not; ring if selected
      const bg = visibleToDrivers ? '#f59e0b' : '#94a3b8';
      const ring = isSelected ? 'box-shadow:0 0 0 4px hsl(210 70% 48%),0 4px 14px rgba(0,0,0,0.3);' : 'box-shadow:0 2px 8px rgba(0,0,0,0.25);';
      const dashed = !hasCoords ? 'border-style:dashed;' : '';

      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.innerHTML = `
        <div style="position:relative;">
          <div style="width:38px;height:38px;background:${bg};border-radius:50%;border:3px solid white;${dashed}${ring}display:flex;align-items:center;justify-content:center;font-size:16px;">🏪</div>
          ${activeCount > 0 ? `<div style="position:absolute;top:-4px;right:-4px;background:hsl(0 75% 50%);color:white;border:2px solid white;border-radius:9999px;min-width:18px;height:18px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;">${activeCount}</div>` : ''}
        </div>`;

      el.addEventListener('click', (ev) => {
        if (!editModeRef.current) return;
        ev.stopPropagation();
        setSelectedStoreId(prev => prev === store.id ? null : store.id);
      });

      const popup = new mapboxgl.Popup({ offset: 22 }).setHTML(`
        <div style="font-family:system-ui;padding:6px;min-width:160px;">
          <strong style="font-size:13px;">${escapeHtml(store.name)}</strong>
          <div style="font-size:11px;opacity:0.7;margin-top:2px;">${escapeHtml(store.address ?? '')}</div>
          <div style="font-size:11px;margin-top:6px;">
            ${activeCount > 0 ? `🔴 <strong>${activeCount}</strong> ενεργές παραγγελίες` : '⚪ Καμία ενεργή παραγγελία'}
          </div>
          <div style="font-size:10.5px;margin-top:4px;color:${visibleToDrivers ? '#10b981' : '#94a3b8'};font-weight:600;">
            ${visibleToDrivers ? '✓ Ορατό στους οδηγούς' : '✗ Κρυφό από οδηγούς'}
          </div>
          ${!hasCoords ? '<div style="font-size:10.5px;margin-top:4px;color:#f59e0b;font-weight:600;">⚠ Χωρίς συντεταγμένες — σύρετο στη σωστή θέση</div>' : ''}
          ${editMode ? `<div style="font-size:10.5px;margin-top:6px;color:hsl(210 70% 48%);font-weight:600;">${isSelected ? '👆 Κλικ στον χάρτη για τοποθέτηση' : 'Κλικ για επιλογή'}</div>` : ''}
        </div>
      `);

      const marker = new mapboxgl.Marker({ element: el, draggable: editMode })
        .setLngLat([lng, lat])
        .setPopup(isSelected ? undefined : popup)
        .addTo(map);

      if (editMode) {
        marker.on('dragend', async () => {
          const { lng: nLng, lat: nLat } = marker.getLngLat();
          if (distKm(nLat, nLng) > MAX_KM) {
            toast.error('Εκτός Ιωαννίνων (>15 χλμ) — δεν θα είναι ορατό στους οδηγούς');
          }
          const { error } = await supabase
            .from('stores')
            .update({ latitude: nLat, longitude: nLng })
            .eq('id', store.id);
          if (error) {
            toast.error(`Αποτυχία: ${error.message}`);
            marker.setLngLat([lng, lat]);
          } else {
            toast.success(`${store.name} μετακινήθηκε`);
            setStores(prev => prev.map(s => s.id === store.id ? { ...s, latitude: nLat, longitude: nLng } : s));
          }
        });
      }

      markersRef.current.push(marker);
    });
  }, [stores, orderCounts, selectedStoreId, editMode]);

  useEffect(() => { if (!editMode) setSelectedStoreId(null); }, [editMode]);

  if (tokenLoading) {
    return <Card className="h-[520px] flex items-center justify-center">
      <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </Card>;
  }
  if (!token) {
    return <Card className="h-[520px] flex items-center justify-center text-muted-foreground">
      Mapbox token not configured
    </Card>;
  }

  const visibleCount = stores.filter(s =>
    (s.is_active ?? true) && (orderCounts[s.id] ?? 0) > 0 && s.latitude != null && s.longitude != null
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading font-bold text-xl">Driver Map Editor</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Προεπισκόπηση χάρτη οδηγών — μόνο καταστήματα με ενεργές παραγγελίες είναι ορατά στους οδηγούς.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <Switch id="edit-mode" checked={editMode} onCheckedChange={setEditMode} />
            <Label htmlFor="edit-mode" className="text-xs cursor-pointer">Λειτουργία επεξεργασίας</Label>
          </div>
          <Badge variant="outline" className="gap-1.5 bg-amber-500/10 border-amber-500/30">
            🏪 {visibleCount} ορατά
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            Σύνολο: {stores.length}
          </Badge>
        </div>
      </div>

      {editMode && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          {selectedStoreId
            ? <>📍 <strong>{stores.find(s => s.id === selectedStoreId)?.name}</strong> επιλέχθηκε — κλικ οπουδήποτε στον χάρτη για τοποθέτηση.</>
            : <>👉 Κλικ σε ένα 🏪 για επιλογή, μετά κλικ στον χάρτη για νέα θέση. Καταστήματα χωρίς συντεταγμένες εμφανίζονται με διακεκομμένο περίγραμμα στο κέντρο της πόλης.</>}
        </div>
      )}

      <Card className="overflow-hidden">
        <div ref={mapContainer} className="h-[520px] w-full" />
      </Card>
    </div>
  );
}
