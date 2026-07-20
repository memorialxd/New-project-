import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, MapPin, Save, Locate } from 'lucide-react';
import { toast } from 'sonner';

interface ServiceZone {
  id: string;
  city: string;
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  is_active: boolean;
}

const DEFAULT_CENTER: [number, number] = [20.9853, 39.6650]; // Ιωάννινα
const CIRCLE_POINTS = 64;

/** Generate a GeoJSON Polygon approximating a circle (radius in km) around [lng,lat]. */
function circlePolygon(lng: number, lat: number, radiusKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const earthRadius = 6371;
  const d = radiusKm / earthRadius;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  for (let i = 0; i <= CIRCLE_POINTS; i++) {
    const bearing = (i / CIRCLE_POINTS) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(bearing));
    const lng2 = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(lat2),
    );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export default function ServiceZonesEditor() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const centerMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const { token } = useMapboxToken();

  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCity, setNewCity] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = zones.find(z => z.id === selectedId) ?? null;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_zones')
      .select('*')
      .order('city');
    if (error) { toast.error('Αποτυχία φόρτωσης ζωνών'); return; }
    setZones((data ?? []) as ServiceZone[]);
    if (data && data.length && !selectedId) setSelectedId(data[0].id);
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  // Init map
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: DEFAULT_CENTER,
      zoom: 12,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource('zone-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zone-circle',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'zone-line',
        type: 'line',
        source: 'zone-circle',
        paint: { 'line-color': '#2563eb', 'line-width': 2 },
      });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [token]);

  // Render selected zone on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const draw = () => {
      const src = map.getSource('zone-circle') as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      const poly = circlePolygon(selected.center_longitude, selected.center_latitude, selected.radius_km);
      src.setData({ type: 'FeatureCollection', features: [poly] });
    };
    if (map.isStyleLoaded()) draw(); else map.once('load', draw);

    // center marker (draggable)
    if (centerMarkerRef.current) centerMarkerRef.current.remove();
    const marker = new mapboxgl.Marker({ color: '#2563eb', draggable: true })
      .setLngLat([selected.center_longitude, selected.center_latitude])
      .addTo(map);
    marker.on('dragend', () => {
      const { lng, lat } = marker.getLngLat();
      setZones(prev => prev.map(z => z.id === selected.id ? { ...z, center_longitude: lng, center_latitude: lat } : z));
    });
    centerMarkerRef.current = marker;

    map.flyTo({ center: [selected.center_longitude, selected.center_latitude], zoom: 12 });
  }, [selectedId, selected?.center_latitude, selected?.center_longitude, selected?.radius_km]);

  const updateLocal = (patch: Partial<ServiceZone>) => {
    if (!selected) return;
    setZones(prev => prev.map(z => z.id === selected.id ? { ...z, ...patch } : z));
  };

  const persist = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await supabase
      .from('service_zones')
      .update({
        center_latitude: selected.center_latitude,
        center_longitude: selected.center_longitude,
        radius_km: selected.radius_km,
        is_active: selected.is_active,
      })
      .eq('id', selected.id);
    setSaving(false);
    if (error) toast.error('Αποτυχία αποθήκευσης'); else toast.success('Η ζώνη αποθηκεύτηκε');
  };

  const createZone = async () => {
    const city = newCity.trim();
    if (!city) return;
    setCreating(true);
    const map = mapRef.current;
    const c = map ? map.getCenter() : { lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] };
    const { data, error } = await supabase
      .from('service_zones')
      .insert({ city, center_latitude: c.lat, center_longitude: c.lng, radius_km: 5, is_active: true })
      .select()
      .single();
    setCreating(false);
    if (error) { toast.error(error.message.includes('duplicate') ? 'Η πόλη υπάρχει ήδη' : 'Αποτυχία'); return; }
    setNewCity('');
    setZones(prev => [...prev, data as ServiceZone].sort((a, b) => a.city.localeCompare(b.city)));
    setSelectedId((data as ServiceZone).id);
    toast.success(`Δημιουργήθηκε ζώνη: ${city}`);
  };

  const removeZone = async (id: string) => {
    if (!confirm('Διαγραφή ζώνης; Παραγγελίες εκτός των υπόλοιπων ενεργών ζωνών δεν θα γίνονται δεκτές.')) return;
    const { error } = await supabase.from('service_zones').delete().eq('id', id);
    if (error) { toast.error('Αποτυχία διαγραφής'); return; }
    setZones(prev => prev.filter(z => z.id !== id));
    if (selectedId === id) setSelectedId(null);
    toast.success('Η ζώνη διαγράφηκε');
  };

  const recenterOnMap = () => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const c = map.getCenter();
    updateLocal({ center_latitude: c.lat, center_longitude: c.lng });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
      {/* LEFT: zones list + editor */}
      <div className="space-y-3">
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h2 className="font-heading font-semibold text-foreground">Ζώνες Παράδοσης</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Μια ζώνη ανά πόλη. Διευθύνσεις πελατών εκτός κύκλου μπλοκάρονται αυτόματα στο checkout.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="π.χ. Ιωάννινα"
              value={newCity}
              onChange={e => setNewCity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createZone()}
              maxLength={60}
            />
            <Button onClick={createZone} disabled={!newCity.trim() || creating} size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        <Card className="p-2 space-y-1 max-h-72 overflow-y-auto">
          {zones.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Καμία ζώνη ακόμη.</p>
          )}
          {zones.map(z => (
            <button
              key={z.id}
              onClick={() => setSelectedId(z.id)}
              className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between transition-colors ${
                z.id === selectedId ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/60'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{z.city}</p>
                <p className="text-[11px] text-muted-foreground">
                  ακτίνα {Number(z.radius_km).toFixed(1)} km
                </p>
              </div>
              <Badge variant={z.is_active ? 'default' : 'outline'} className="text-[10px]">
                {z.is_active ? 'ενεργή' : 'ανενεργή'}
              </Badge>
            </button>
          ))}
        </Card>

        {selected && (
          <Card className="p-4 space-y-4">
            <div>
              <h3 className="font-heading font-semibold text-foreground">{selected.city}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Σύρε τον μπλε δείκτη στον χάρτη για να μετακινήσεις το κέντρο.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Ακτίνα κάλυψης</Label>
                <Badge variant="outline" className="font-heading">{Number(selected.radius_km).toFixed(1)} km</Badge>
              </div>
              <Slider
                value={[Number(selected.radius_km)]}
                min={1}
                max={30}
                step={0.5}
                onValueChange={([v]) => updateLocal({ radius_km: v })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
              <Label className="text-sm">Ενεργή</Label>
              <Switch
                checked={selected.is_active}
                onCheckedChange={(v) => updateLocal({ is_active: v })}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={recenterOnMap}>
                <Locate className="h-3.5 w-3.5 mr-1.5" />
                Κέντρο = θέα χάρτη
              </Button>
              <Button variant="ghost" size="sm" onClick={() => removeZone(selected.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            <Button onClick={persist} disabled={saving} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Αποθήκευση Ζώνης
            </Button>
          </Card>
        )}
      </div>

      {/* RIGHT: map */}
      <Card className="p-0 overflow-hidden h-[640px]">
        <div ref={mapContainer} className="w-full h-full" />
      </Card>
    </div>
  );
}
