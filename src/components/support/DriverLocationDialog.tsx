import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { Loader2, MapPin, Navigation, Gauge, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  driverId: string;
  driverName?: string;
}

interface Loc {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  updated_at: string;
}

export function DriverLocationDialog({ open, onOpenChange, driverId, driverName }: Props) {
  const { token } = useMapboxToken();
  const [loc, setLoc] = useState<Loc | null>(null);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // Fetch location whenever dialog opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('driver_locations')
        .select('latitude, longitude, speed, heading, updated_at')
        .eq('driver_id', driverId)
        .maybeSingle();
      setLoc((data as Loc) ?? null);
      setLoading(false);
    })();
  }, [open, driverId]);

  // Realtime updates
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel(`support-watch-${driverId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` },
        (payload) => setLoc(payload.new as Loc)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, driverId]);

  // Init map
  useEffect(() => {
    if (!open || !token || !containerRef.current || !loc || mapRef.current) return;
    mapboxgl.accessToken = token;
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [loc.longitude, loc.latitude],
      zoom: 14,
    });

    const el = document.createElement('div');
    el.className = 'h-4 w-4 rounded-full bg-primary border-2 border-background shadow-lg';
    markerRef.current = new mapboxgl.Marker(el)
      .setLngLat([loc.longitude, loc.latitude])
      .addTo(mapRef.current);
  }, [open, token, loc]);

  // Update marker on new location
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !loc) return;
    markerRef.current.setLngLat([loc.longitude, loc.latitude]);
    mapRef.current.easeTo({ center: [loc.longitude, loc.latitude], duration: 600 });
  }, [loc]);

  // Cleanup map on close
  useEffect(() => {
    if (open) return;
    mapRef.current?.remove();
    mapRef.current = null;
    markerRef.current = null;
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Θέση οδηγού {driverName ? `· ${driverName}` : ''}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="h-80 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !loc ? (
          <div className="h-40 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-1">
            <MapPin className="h-8 w-8 opacity-30" />
            <p>Δεν υπάρχει διαθέσιμη θέση για αυτόν τον οδηγό.</p>
            <p className="text-xs">Ίσως είναι offline ή δεν έχει ενεργοποιήσει την τοποθεσία.</p>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="h-80 rounded-lg overflow-hidden border" />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted/50 p-2">
                <Clock className="h-3 w-3 mx-auto mb-0.5 text-muted-foreground" />
                <p className="font-semibold">{formatDistanceToNow(new Date(loc.updated_at), { addSuffix: true })}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <Gauge className="h-3 w-3 mx-auto mb-0.5 text-muted-foreground" />
                <p className="font-semibold">
                  {loc.speed != null ? `${Math.round(loc.speed * 3.6)} km/h` : '—'}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <Navigation className="h-3 w-3 mx-auto mb-0.5 text-muted-foreground" />
                <p className="font-semibold">
                  {loc.heading != null ? `${Math.round(loc.heading)}°` : '—'}
                </p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
