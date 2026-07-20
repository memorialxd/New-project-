import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  driverId?: string | null;
  storeLat?: number | null;
  storeLng?: number | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  status: string;
}

function bearing(a: [number, number], b: [number, number]) {
  const [lng1, lat1] = a.map((x) => (x * Math.PI) / 180) as [number, number];
  const [lng2, lat2] = b.map((x) => (x * Math.PI) / 180) as [number, number];
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const PICKED_UP_STATES = new Set(['picked_up', 'arrived_customer']);

export default function LiveTrackingMap({
  driverId,
  storeLat,
  storeLng,
  deliveryLat,
  deliveryLng,
  status,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarker = useRef<mapboxgl.Marker | null>(null);
  const driverIcon = useRef<HTMLDivElement | null>(null);
  const lastPos = useRef<[number, number] | null>(null);
  const { token } = useMapboxToken();
  const [driverPos, setDriverPos] = useState<[number, number] | null>(null);

  // ── driver location subscription ──────────────────
  useEffect(() => {
    if (!driverId) return;
    supabase
      .from('driver_locations')
      .select('latitude, longitude')
      .eq('driver_id', driverId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.latitude && data?.longitude) {
          setDriverPos([data.longitude, data.latitude]);
        }
      });

    const ch = supabase
      .channel(`live-track-${driverId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` },
        (p) => {
          const r = p.new as any;
          if (r?.latitude && r?.longitude) setDriverPos([r.longitude, r.latitude]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [driverId]);

  // ── init map ──────────────────────────────────────
  useEffect(() => {
    if (!token || !container.current || mapRef.current) return;
    const center =
      driverPos ??
      (deliveryLat && deliveryLng ? ([deliveryLng, deliveryLat] as [number, number]) : null) ??
      (storeLat && storeLng ? ([storeLng, storeLat] as [number, number]) : null);
    if (!center) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom: 13.5,
      attributionControl: false,
      pitch: 30,
    });
    mapRef.current = map;

    map.on('load', () => {
      // Store marker
      if (storeLat && storeLng) {
        const el = document.createElement('div');
        el.innerHTML = `<div style="width:38px;height:38px;border-radius:50%;background:hsl(var(--primary));border:3px solid white;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;font-size:18px">🏪</div>`;
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([storeLng, storeLat])
          .addTo(map);
      }
      // Delivery marker
      if (deliveryLat && deliveryLng) {
        const el = document.createElement('div');
        el.innerHTML = `<div style="width:38px;height:38px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:hsl(var(--accent));border:3px solid white;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:16px">🏠</span></div>`;
        new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([deliveryLng, deliveryLat])
          .addTo(map);
      }

      // Route source
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({
        id: 'route-shadow',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-opacity': 0.08, 'line-width': 9 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'hsl(var(--primary))', 'line-width': 5 },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      driverMarker.current = null;
    };
  }, [token, storeLat, storeLng, deliveryLat, deliveryLng, driverPos == null]);

  // ── route fetch ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !token) return;
    const from = PICKED_UP_STATES.has(status) && driverPos
      ? driverPos
      : storeLat && storeLng
      ? ([storeLng, storeLat] as [number, number])
      : null;
    const to = PICKED_UP_STATES.has(status) && deliveryLat && deliveryLng
      ? ([deliveryLng, deliveryLat] as [number, number])
      : storeLat && storeLng
      ? ([storeLng, storeLat] as [number, number])
      : null;
    // route from store→customer always (efood-style)
    const a = storeLat && storeLng ? ([storeLng, storeLat] as [number, number]) : null;
    const b = deliveryLat && deliveryLng ? ([deliveryLng, deliveryLat] as [number, number]) : null;
    if (!a || !b) return;

    const url = `https://api.mapbox.com/directions/v5/mapbox/cycling/${a[0]},${a[1]};${b[0]},${b[1]}?geometries=geojson&overview=full&access_token=${token}`;
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const coords = d?.routes?.[0]?.geometry?.coordinates;
        if (!coords) return;
        const apply = () => {
          const src = map.getSource('route') as mapboxgl.GeoJSONSource | undefined;
          if (!src) return;
          src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
          // Fit bounds to route + driver
          const bounds = new mapboxgl.LngLatBounds();
          coords.forEach((c: number[]) => bounds.extend(c as [number, number]));
          if (driverPos) bounds.extend(driverPos);
          map.fitBounds(bounds, { padding: { top: 80, bottom: 360, left: 60, right: 60 }, duration: 800, maxZoom: 16 });
        };
        if (map.isStyleLoaded()) apply();
        else map.once('load', apply);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, storeLat, storeLng, deliveryLat, deliveryLng, status]);

  // ── animate driver (bike) ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !driverPos) return;

    const ensureMarker = () => {
      if (driverMarker.current) return;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;';
      const pulse = document.createElement('div');
      pulse.style.cssText =
        'position:absolute;inset:0;border-radius:50%;background:hsl(var(--primary) / .35);animation:driverPulse 1.6s ease-out infinite;';
      const inner = document.createElement('div');
      inner.style.cssText =
        'position:relative;width:46px;height:46px;border-radius:50%;background:white;box-shadow:0 6px 20px rgba(0,0,0,.35),0 0 0 4px hsl(var(--primary));display:flex;align-items:center;justify-content:center;font-size:24px;transition:transform .8s ease-out;';
      inner.textContent = '🛵';
      wrap.appendChild(pulse);
      wrap.appendChild(inner);
      driverIcon.current = inner;
      driverMarker.current = new mapboxgl.Marker({ element: wrap, anchor: 'center' })
        .setLngLat(driverPos)
        .addTo(map);
      if (!document.getElementById('driver-pulse-kf')) {
        const st = document.createElement('style');
        st.id = 'driver-pulse-kf';
        st.textContent = '@keyframes driverPulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.2);opacity:0}}';
        document.head.appendChild(st);
      }
    };

    const place = () => {
      ensureMarker();
      if (!driverMarker.current) return;
      const prev = lastPos.current;
      driverMarker.current.setLngLat(driverPos);
      if (prev && driverIcon.current) {
        const b = bearing(prev, driverPos);
        driverIcon.current.style.transform = `rotate(${b - 90}deg)`;
      }
      lastPos.current = driverPos;
      const cam = map.getCenter();
      const dist = Math.hypot(cam.lng - driverPos[0], cam.lat - driverPos[1]);
      if (dist > 0.01) map.easeTo({ center: driverPos, duration: 1200 });
    };

    // Markers work even before style load — place immediately.
    place();
  }, [driverPos]);

  return <div ref={container} className="absolute inset-0" />;
}
