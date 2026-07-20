import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';
import { escapeHtml } from '@/lib/escape-html';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MapPin, Loader2 } from 'lucide-react';
import { geocodeAddress } from '@/lib/geocode';
import { toast } from 'sonner';

interface DriverLocation {
  driver_id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  updated_at: string;
}

interface StoreMarker {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  is_active: boolean | null;
}

interface DriverInfo {
  driver_id: string;
  name: string;
  code: string | null;
}

export default function AdminDriversMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const storeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const { token, loading: tokenLoading } = useMapboxToken();

  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [driverInfos, setDriverInfos] = useState<Map<string, DriverInfo>>(new Map());
  const [stores, setStores] = useState<StoreMarker[]>([]);
  const [missingCoords, setMissingCoords] = useState<{ id: string; name: string; address: string }[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [editStores, setEditStores] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const editStoresRef = useRef(false);
  const selectedStoreIdRef = useRef<string | null>(null);
  const storesRef = useRef<StoreMarker[]>([]);
  useEffect(() => { editStoresRef.current = editStores; }, [editStores]);
  useEffect(() => { selectedStoreIdRef.current = selectedStoreId; }, [selectedStoreId]);
  useEffect(() => { storesRef.current = stores; }, [stores]);

  // Load data
  useEffect(() => {
    async function load() {
      const [{ data: profiles }, { data: driverProfiles }, { data: storesData }] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').eq('role', 'driver' as any),
        supabase.from('driver_profiles').select('user_id, driver_code' as any),
        supabase.from('stores').select('id, name, address, latitude, longitude, is_active'),
      ]);

      const map = new Map<string, DriverInfo>();
      profiles?.forEach((p: any) => {
        map.set(p.user_id, { driver_id: p.user_id, name: p.full_name || p.user_id.slice(0, 8), code: null });
      });
      (driverProfiles as any[])?.forEach((dp: any) => {
        const existing = map.get(dp.user_id);
        if (existing) existing.code = dp.driver_code;
      });
      setDriverInfos(map);

      if (storesData) {
        const DEFAULT_LAT = 39.1600;
        const DEFAULT_LNG = 20.9853;
        const missingList: { id: string; name: string; address: string }[] = [];
        let missing = 0;
        const list = storesData.map(s => {
          if (s.latitude != null && s.longitude != null) {
            return { ...s, latitude: s.latitude as number, longitude: s.longitude as number } as StoreMarker;
          }
          missingList.push({ id: s.id, name: s.name, address: s.address ?? '' });
          const i = missing++;
          const angle = (i * 137.5) * (Math.PI / 180);
          const r = 0.0008 + Math.floor(i / 12) * 0.0006;
          return {
            ...s,
            latitude: DEFAULT_LAT + Math.sin(angle) * r,
            longitude: DEFAULT_LNG + Math.cos(angle) * r,
          } as StoreMarker;
        });
        setStores(list);
        setMissingCoords(missingList);
      }
    }
    load();
  }, []);

  // Fetch + subscribe to driver locations
  useEffect(() => {
    supabase.from('driver_locations').select('*').then(({ data }) => {
      if (data) setLocations(data as DriverLocation[]);
    });

    const channel = supabase
      .channel('admin-driver-locations-mapbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (payload) => {
        const loc = payload.new as DriverLocation;
        if (!loc?.driver_id) return;
        setLocations(prev => {
          const idx = prev.findIndex(l => l.driver_id === loc.driver_id);
          if (idx >= 0) { const u = [...prev]; u[idx] = loc; return u; }
          return [...prev, loc];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Init map
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [20.8537, 39.6650],
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    // Click-to-place: when edit mode is on AND a store is selected,
    // clicking the map relocates that store to the clicked coords.
    map.on('click', async (e) => {
      if (!editStoresRef.current) return;
      const storeId = selectedStoreIdRef.current;
      if (!storeId) return;
      const store = storesRef.current.find(s => s.id === storeId);
      if (!store) return;
      const { lng, lat } = e.lngLat;
      const { error } = await supabase
        .from('stores')
        .update({ latitude: lat, longitude: lng })
        .eq('id', storeId);
      if (error) {
        toast.error(`Αποτυχία τοποθέτησης ${store.name}`);
      } else {
        toast.success(`${store.name}: νέα θέση αποθηκεύτηκε`);
        setStores(prev => prev.map(s => s.id === storeId ? { ...s, latitude: lat, longitude: lng } : s));
        setSelectedStoreId(null);
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [token]);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Driver markers
    const activeIds = new Set(locations.map(l => l.driver_id));
    markersRef.current.forEach((marker, id) => {
      if (!activeIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    });

    locations.forEach(loc => {
      const info = driverInfos.get(loc.driver_id);
      const existing = markersRef.current.get(loc.driver_id);

      if (existing) {
        existing.setLngLat([loc.longitude, loc.latitude]);
      } else {
        const el = document.createElement('div');
        el.innerHTML = `<div style="width:36px;height:36px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 2px 12px rgba(59,130,246,0.5);display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;">🚗</div>`;
        
        const popup = new mapboxgl.Popup({ offset: 20 }).setHTML(`
          <div style="text-align:center;font-family:system-ui;padding:4px;">
            <strong>${escapeHtml(info?.name || loc.driver_id.slice(0, 8))}</strong>
            ${info?.code ? `<br/><span style="font-size:11px;opacity:0.7;">${escapeHtml(info.code)}</span>` : ''}
            ${loc.speed != null && loc.speed > 0 ? `<br/><span style="font-size:11px;">${(loc.speed * 3.6).toFixed(0)} km/h</span>` : ''}
          </div>
        `);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([loc.longitude, loc.latitude])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.set(loc.driver_id, marker);
      }
    });
  }, [locations, driverInfos]);

  // Store markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    storeMarkersRef.current.forEach(m => m.remove());
    storeMarkersRef.current = [];

    stores.forEach(store => {
      const isSelected = editStores && selectedStoreId === store.id;
      const ring = isSelected ? 'box-shadow:0 0 0 4px hsl(var(--primary)),0 2px 8px rgba(249,115,22,0.6);' : 'box-shadow:0 2px 8px rgba(249,115,22,0.4);';
      const el = document.createElement('div');
      el.innerHTML = `<div style="width:32px;height:32px;background:#f97316;border-radius:50%;border:3px solid white;${ring}display:flex;align-items:center;justify-content:center;font-size:14px;cursor:${editStores ? 'pointer' : 'pointer'};">🏪</div>`;

      // Click on the marker selects the store (in edit mode).
      // We stop propagation so the map's click handler doesn't fire.
      el.addEventListener('click', (ev) => {
        if (!editStoresRef.current) return;
        ev.stopPropagation();
        setSelectedStoreId(prev => prev === store.id ? null : store.id);
      });

      const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(`
        <div style="text-align:center;font-family:system-ui;padding:4px;">
          <strong>${escapeHtml(store.name)}</strong>
          <br/><span style="font-size:11px;opacity:0.7;">${escapeHtml(store.address)}</span>
          <br/><span style="font-size:11px;">${store.is_active ? '✅ Ενεργό' : '❌ Ανενεργό'}</span>
          ${editStores ? `<br/><span style="font-size:11px;color:#f97316;font-weight:600;">${isSelected ? '👆 Κλικ στον χάρτη για τοποθέτηση' : 'Κλικ για επιλογή'}</span>` : ''}
        </div>
      `);

      // Disable drag — we now use click-to-place instead (more reliable for stores
      // that start at the default center and need to move long distances).
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([store.longitude, store.latitude])
        .setPopup(editStores && isSelected ? undefined : popup)
        .addTo(map);

      storeMarkersRef.current.push(marker);
    });

    // Fit bounds
    const allPoints = [
      ...locations.map(l => [l.longitude, l.latitude] as [number, number]),
      ...stores.map(s => [s.longitude, s.latitude] as [number, number]),
    ];
    if (allPoints.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      allPoints.forEach(p => bounds.extend(p));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    }
  }, [stores, locations, editStores, selectedStoreId]);

  // Clear selection when leaving edit mode
  useEffect(() => {
    if (!editStores) setSelectedStoreId(null);
  }, [editStores]);

  if (tokenLoading) {
    return (
      <Card>
        <CardContent className="h-[500px] flex items-center justify-center">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!token) {
    return (
      <Card>
        <CardContent className="h-[500px] flex items-center justify-center text-muted-foreground">
          Mapbox token not configured
        </CardContent>
      </Card>
    );
  }

  const handleBulkGeocode = async () => {
    if (geocoding || missingCoords.length === 0) return;
    setGeocoding(true);
    let ok = 0;
    let fail = 0;
    for (const s of missingCoords) {
      if (!s.address?.trim()) { fail++; continue; }
      const res = await geocodeAddress(s.address);
      if (!res) { fail++; continue; }
      const { error } = await supabase
        .from('stores')
        .update({ latitude: res.latitude, longitude: res.longitude })
        .eq('id', s.id);
      if (error) { fail++; continue; }
      ok++;
      setStores(prev => prev.map(x => x.id === s.id
        ? { ...x, latitude: res.latitude, longitude: res.longitude } : x));
    }
    setMissingCoords(prev => prev.filter(s => !s.address?.trim() || fail === missingCoords.length));
    setGeocoding(false);
    if (ok > 0) toast.success(`Γεωκωδικοποίηση: ${ok} επιτυχία${fail ? `, ${fail} αποτυχία` : ''}`);
    else toast.error('Δεν βρέθηκαν συντεταγμένες');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-heading font-bold text-xl">Live Χάρτης</h2>
        <div className="flex flex-wrap items-center gap-3">
          {missingCoords.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkGeocode}
              disabled={geocoding}
              className="gap-1.5 h-8"
            >
              {geocoding
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <MapPin className="h-3.5 w-3.5" />}
              Αυτόματη τοποθέτηση ({missingCoords.length})
            </Button>
          )}
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <Switch id="edit-stores" checked={editStores} onCheckedChange={setEditStores} />
            <Label htmlFor="edit-stores" className="text-xs cursor-pointer">
              Μετακίνηση καταστημάτων
            </Label>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            {locations.length} οδηγοί
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            🏪 {stores.length} καταστήματα
          </Badge>
        </div>
      </div>
      {editStores && (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-foreground">
          {selectedStoreId
            ? <>📍 <strong>{stores.find(s => s.id === selectedStoreId)?.name}</strong> επιλέχθηκε — κλικ οπουδήποτε στον χάρτη για να το τοποθετήσεις.</>
            : <>👉 Κλικ σε ένα 🏪 για να το επιλέξεις, μετά κλικ στον χάρτη για νέα θέση.</>}
        </div>
      )}
      <Card className="overflow-hidden">
        <div ref={mapContainer} className="h-[500px] w-full" />
      </Card>
    </div>
  );
}
