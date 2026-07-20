import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Loader2, X, Navigation, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { geocodeAddress } from '@/lib/geocode';

interface AddressResult {
  display_name: string;
  lat: number;
  lon: number;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string, lat?: number, lon?: number) => void;
  placeholder?: string;
  maxLength?: number;
}

// Ioannina center
const IOANNINA: [number, number] = [20.8537, 39.6650]; // [lng, lat]
// Bias bbox around Ioannina region (minLng, minLat, maxLng, maxLat)
const IOANNINA_BBOX = '20.7,39.55,20.95,39.75';

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = 'Εισάγετε τη διεύθυνση παράδοσης',
  maxLength = 200,
}: AddressAutocompleteProps) {
  const { token, loading: tokenLoading } = useMapboxToken();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapPin, setMapPin] = useState<{ lat: number; lon: number } | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 3 || !token) {
      setResults([]);
      setNoResults(false);
      return;
    }
    setLoading(true);
    setNoResults(false);
    try {
      // Detect a house number in the user query (e.g. "Δημοκρατίας 12")
      const numMatch = q.match(/\b(\d{1,4}[A-Za-zΑ-Ωα-ω]?)\b/);
      const typedNumber = numMatch ? numMatch[1] : null;

      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&country=gr&language=el&limit=8&bbox=${IOANNINA_BBOX}&proximity=${IOANNINA[0]},${IOANNINA[1]}&types=address,poi,place,locality,neighborhood&autocomplete=true`;
      const res = await fetch(url);
      const data = await res.json();
      const features = (data.features ?? []) as Array<{
        place_name: string;
        center: [number, number];
        address?: string;
        place_type?: string[];
        text?: string;
      }>;

      // If user typed a number, prefer features that actually include it.
      // Mapbox returns the house number in feature.address for "address" results.
      const withNumber = typedNumber
        ? features.filter(f => f.address && String(f.address) === typedNumber)
        : features;

      const chosen = withNumber.length > 0 ? withNumber : features;

      const mapped: AddressResult[] = chosen.map(f => {
        let label = f.place_name;
        // If user typed a number but result doesn't have one, inject it for clarity
        if (typedNumber && !f.address && f.place_type?.includes('address') && f.text) {
          label = label.replace(f.text, `${f.text} ${typedNumber}`);
        }
        return {
          display_name: label,
          lon: f.center[0],
          lat: f.center[1],
        };
      });
      setResults(mapped);
      setOpen(mapped.length > 0);
      setNoResults(mapped.length === 0 && q.length >= 3);
    } catch {
      setResults([]);
      setNoResults(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const hasCoordsRef = useRef(false);

  const handleInput = (val: string) => {
    setQuery(val);
    onChange(val);
    hasCoordsRef.current = false;
    setNoResults(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  };

  const handleBlur = async () => {
    // If user typed an address but never picked a suggestion, resolve via Google
    // (more accurate for Greek street numbers than Mapbox autocomplete).
    if (hasCoordsRef.current) return;
    const q = query.trim();
    if (q.length < 5) return;
    const res = await geocodeAddress(q);
    if (res) {
      hasCoordsRef.current = true;
      onChange(res.formatted || q, res.latitude, res.longitude);
      setQuery(res.formatted || q);
    }
  };

  const selectResult = (r: AddressResult) => {
    setQuery(r.display_name);
    onChange(r.display_name, r.lat, r.lon);
    hasCoordsRef.current = true;
    setOpen(false);
    setResults([]);
    setNoResults(false);
    setShowMap(false);
  };

  const clear = () => {
    setQuery('');
    onChange('');
    setResults([]);
    setOpen(false);
    setNoResults(false);
    setShowMap(false);
    setMapPin(null);
  };

  const reverseGeocode = useCallback(async (lat: number, lon: number) => {
    setReverseLoading(true);
    try {
      if (!token) throw new Error('no token');
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${token}&language=el&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      const name = data.features?.[0]?.place_name as string | undefined;
      if (name) {
        setQuery(name);
        onChange(name, lat, lon);
      } else {
        const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        setQuery(fallback);
        onChange(fallback, lat, lon);
      }
      hasCoordsRef.current = true;
    } catch {
      const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      setQuery(fallback);
      onChange(fallback, lat, lon);
      hasCoordsRef.current = true;
    } finally {
      setReverseLoading(false);
    }
  }, [token, onChange]);

  const handleMapClick = (lat: number, lon: number) => {
    setMapPin({ lat, lon });
    reverseGeocode(lat, lon);
  };

  const confirmMapPin = () => {
    setShowMap(false);
    setNoResults(false);
  };

  const locateGPS = () => {
    if (!navigator.geolocation) {
      toast.error('Η τοποθεσία GPS δεν υποστηρίζεται στη συσκευή σας');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setMapPin({ lat, lon });
        setShowMap(true);
        reverseGeocode(lat, lon);
        setGpsLoading(false);
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === 1) {
          toast.error('Η πρόσβαση στην τοποθεσία απορρίφθηκε. Ενεργοποιήστε την τοποθεσία στις ρυθμίσεις.');
        } else if (err.code === 2) {
          toast.error('Δεν ήταν δυνατή η εύρεση τοποθεσίας. Δοκιμάστε ξανά.');
        } else {
          toast.error('Λήξη χρόνου τοποθεσίας. Δοκιμάστε ξανά.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Init map when shown
  useEffect(() => {
    if (!showMap || !token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const center: [number, number] = mapPin ? [mapPin.lon, mapPin.lat] : IOANNINA;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom: 14,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (e) => {
      handleMapClick(e.lngLat.lat, e.lngLat.lng);
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, token]);

  // Update / create marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPin) return;
    if (markerRef.current) {
      markerRef.current.setLngLat([mapPin.lon, mapPin.lat]);
    } else {
      markerRef.current = new mapboxgl.Marker({ color: 'hsl(var(--primary))' })
        .setLngLat([mapPin.lon, mapPin.lat])
        .addTo(map);
    }
    map.easeTo({ center: [mapPin.lon, mapPin.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
  }, [mapPin]);

  return (
    <div ref={containerRef} className="relative space-y-2">
      <div className="relative">
        <Input
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          maxLength={maxLength}
          className="pr-16"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {(loading || tokenLoading) && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />}
          {query && !loading && (
            <button onClick={clear} className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-[var(--shadow-lg)] max-h-52 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => selectResult(r)}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex items-start gap-2 border-b border-border last:border-0"
            >
              <MapPin className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-foreground line-clamp-2">{r.display_name}</span>
            </button>
          ))}
        </div>
      )}

      {noResults && !showMap && (
        <div className="bg-muted/50 rounded-lg p-3 text-center space-y-2">
          <p className="text-sm text-muted-foreground">Δεν βρέθηκε η διεύθυνση</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowMap(true)} className="gap-2">
              <Navigation className="h-4 w-4" />
              Σημειώστε στον χάρτη
            </Button>
            <Button variant="outline" size="sm" onClick={locateGPS} disabled={gpsLoading} className="gap-2">
              {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
              Τοποθεσία GPS
            </Button>
          </div>
        </div>
      )}

      {!showMap && !noResults && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2"
          >
            <Navigation className="h-3.5 w-3.5" />
            Σημειώστε στον χάρτη
          </button>
          <button
            type="button"
            onClick={locateGPS}
            disabled={gpsLoading}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2 disabled:opacity-50"
          >
            {gpsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
            Τοποθεσία GPS
          </button>
        </div>
      )}

      {showMap && (
        <div className="rounded-xl overflow-hidden border border-border space-y-2">
          <div className="relative h-64 bg-muted">
            {tokenLoading || !token ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div ref={mapContainer} className="absolute inset-0" />
            )}
            <button
              type="button"
              onClick={locateGPS}
              disabled={gpsLoading}
              className="absolute bottom-3 right-3 z-10 h-10 w-10 bg-card rounded-full shadow-md flex items-center justify-center border border-border hover:bg-accent transition-colors disabled:opacity-50"
              title="Η τοποθεσία μου"
            >
              {gpsLoading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Crosshair className="h-5 w-5 text-primary" />}
            </button>
            {reverseLoading && (
              <div className="absolute top-2 right-2 z-10 bg-card/90 rounded-full p-1.5 shadow">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            )}
          </div>
          <div className="px-3 pb-3 flex items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              {mapPin ? 'Πατήστε ξανά για αλλαγή τοποθεσίας' : 'Πατήστε στον χάρτη για να ορίσετε τοποθεσία'}
            </p>
            <Button size="sm" disabled={!mapPin} onClick={confirmMapPin} className="gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Επιβεβαίωση
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowMap(false)}>
              Ακύρωση
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
