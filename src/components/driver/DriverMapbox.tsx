import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { escapeHtml, safeHttpsUrl } from '@/lib/escape-html';

export interface DriverMapboxHandle {
  recenter: () => void;
  focusOn: (target: 'store' | 'customer') => void;
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  /** Maneuver type: turn, roundabout, merge, fork, arrive, depart, … */
  maneuverType?: string;
  /** Modifier: left, right, slight left, sharp right, straight, uturn, … */
  modifier?: string;
  /** Step start coordinate [lng, lat] */
  location?: [number, number];
  /** Name of the road the step ends on (for the next-street strip) */
  name?: string;
}

export interface RouteInfo {
  distance: number; // meters
  duration: number; // seconds
  steps: RouteStep[];
}


interface NearbyStorePin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  image_url: string | null;
  pendingOrders: number;
}

interface DriverMapboxProps {
  className?: string;
  storeLat?: number | null;
  storeLng?: number | null;
  storeName?: string;
  customerLat?: number | null;
  customerLng?: number | null;
  customerName?: string;
  customerAddress?: string | null;
  navigatingTo?: 'store' | 'customer' | null;
  onRouteUpdate?: (route: RouteInfo | null) => void;
  /** Reports the driver's live position so callers can compute live distance to next maneuver, etc. */
  onDriverPosUpdate?: (pos: { lat: number; lng: number; heading: number | null } | null) => void;
  nearbyStores?: NearbyStorePin[];
  /** When true: camera follows driver position with heading-up rotation + 3D tilt (like Google Maps nav) */
  followMode?: boolean;
}

const DriverMapbox = forwardRef<DriverMapboxHandle, DriverMapboxProps>(function DriverMapbox({
  className,
  storeLat, storeLng, storeName,
  customerLat, customerLng, customerName, customerAddress,
  navigatingTo,
  onRouteUpdate,
  onDriverPosUpdate,
  nearbyStores,
  followMode = false,
}, ref) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const storeMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const customerMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const nearbyMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const { token, loading } = useMapboxToken();
  const [pos, setPos] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const smoothedHeadingRef = useRef<number | null>(null);
  const watchRef = useRef<number | null>(null);
  const routeFetchRef = useRef<AbortController | null>(null);
  const lastRouteKey = useRef('');
  // In-memory cache of recent route responses so we don't re-hit the
  // Mapbox Directions API on every refresh / re-render. Keyed by routeKey.
  const routeCacheRef = useRef<Map<string, { at: number; data: any }>>(new Map());
  const ROUTE_CACHE_TTL_MS = 25_000;

  const followModeRef = useRef(followMode);
  useEffect(() => { followModeRef.current = followMode; }, [followMode]);
  // When the user manually pans/zooms/rotates during follow mode, pause auto-camera until they recenter
  const userInteractingRef = useRef(false);

  // Compute bearing between two coords (fallback when GPS heading unavailable, e.g. desktop)
  const bearingBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  // Watch position (now also captures heading)
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        let heading: number | null = (typeof p.coords.heading === 'number' && !isNaN(p.coords.heading)) ? p.coords.heading : null;
        // Fallback: derive heading from movement vector if GPS doesn't provide one
        if (heading == null && lastPosRef.current) {
          const movedM = Math.hypot(
            (next.lat - lastPosRef.current.lat) * 111000,
            (next.lng - lastPosRef.current.lng) * 111000 * Math.cos(next.lat * Math.PI / 180),
          );
          if (movedM > 3) heading = bearingBetween(lastPosRef.current, next);
        }
        lastPosRef.current = next;
        setPos({ ...next, heading });
      },
      () => setPos({ lat: 39.6650, lng: 20.8537, heading: null }),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); };
  }, []);

  // Forward live driver position to parent (for in-app turn-by-turn UI)
  useEffect(() => { onDriverPosUpdate?.(pos); }, [pos, onDriverPosUpdate]);


  // Auto day/night style based on local hour (06-19 = day)
  const isDaytime = () => {
    const h = new Date().getHours();
    return h >= 6 && h < 19;
  };

  // Init map
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;

    const styleUrl = isDaytime()
      ? 'mapbox://styles/mapbox/navigation-day-v1'
      : 'mapbox://styles/mapbox/navigation-night-v1';

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [pos?.lng ?? 20.8537, pos?.lat ?? 39.6650],
      zoom: 14,
      pitch: 0,
      attributionControl: false,
      antialias: true,
      fadeDuration: 100,
      maxTileCacheSize: 200,
    });

    // GeolocateControl removed — custom recenter button used instead

    const addRouteLayers = () => {
      if (map.getSource('route')) return;
      // Route source + layers (data-driven color by traffic congestion)
      map.addSource('route', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { congestion: [] } },
      });
      // Glow layer
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#3b82f6',
          'line-width': 14,
          'line-opacity': 0.18,
          'line-blur': 10,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
      // Border
      map.addLayer({
        id: 'route-border',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#0b2545',
          'line-width': 8,
          'line-opacity': 0.85,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
      // Main line — traffic-aware gradient (green/yellow/orange/red)
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#22c55e',
          'line-width': 6,
          'line-opacity': 0.95,
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0, '#22c55e',
            1, '#22c55e',
          ],
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
    };

    const add3DBuildings = () => {
      // Find first symbol layer to insert buildings beneath labels
      const layers = map.getStyle().layers || [];
      const labelLayer = layers.find((l: any) => l.type === 'symbol' && l.layout?.['text-field']);
      const labelLayerId = labelLayer?.id;
      if (map.getLayer('3d-buildings')) return;
      const compositeSource = map.getStyle().sources?.composite;
      if (!compositeSource) return;
      map.addLayer(
        {
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': isDaytime() ? '#d6d6d6' : '#2a3340',
            'fill-extrusion-height': [
              'interpolate', ['linear'], ['zoom'],
              14, 0,
              15.5, ['get', 'height'],
            ],
            'fill-extrusion-base': [
              'interpolate', ['linear'], ['zoom'],
              14, 0,
              15.5, ['get', 'min_height'],
            ],
            'fill-extrusion-opacity': 0.65,
          },
        },
        labelLayerId,
      );
    };

    map.on('load', () => {
      addRouteLayers();
      // 3D buildings are expensive on mobile; only add them when the driver
      // enters turn-by-turn navigation (followMode). See effect below.
    });


    // Detect manual user interaction so the follow camera doesn't fight the user
    const onUserMove = (e: any) => {
      if (e?.originalEvent) userInteractingRef.current = true;
    };
    map.on('dragstart', onUserMove);
    map.on('rotatestart', onUserMove);
    map.on('pitchstart', onUserMove);
    map.on('zoomstart', onUserMove);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [token]);


  // Update driver marker (arrow that rotates with heading when in followMode)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pos) return;

    const heading = pos.heading ?? 0;
    // Marker visual rotation: in followMode the map rotates so arrow stays "up";
    // otherwise rotate marker to show direction of travel.
    const markerRotation = followMode ? 0 : heading;

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLngLat([pos.lng, pos.lat]);
      const inner = driverMarkerRef.current.getElement().querySelector<HTMLDivElement>('[data-driver-arrow]');
      if (inner) inner.style.transform = `rotate(${markerRotation}deg)`;
    } else {
      const el = document.createElement('div');
      el.innerHTML = `
        <div style="position:relative;width:34px;height:34px;">
          <div style="position:absolute;inset:-6px;border-radius:50%;background:rgba(59,130,246,0.18);animation:pulse 2s infinite;"></div>
          <div data-driver-arrow style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform 250ms ease-out;transform:rotate(${markerRotation}deg);">
            <svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
              <circle cx="17" cy="17" r="13" fill="#3b82f6" stroke="white" stroke-width="3"/>
              <path d="M17 7 L23 19 L17 16 L11 19 Z" fill="white"/>
            </svg>
          </div>
        </div>`;
      driverMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pos.lng, pos.lat])
        .addTo(map);
    }
  }, [pos, followMode]);

  // Follow-camera: smoothly track driver with heading-up bearing + 3D pitch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pos) return;

    if (!followMode) return;
    if (userInteractingRef.current) return;

    // Smooth heading transitions to avoid jitter
    const rawHeading = pos.heading;
    if (rawHeading != null) {
      const prev = smoothedHeadingRef.current;
      if (prev == null) {
        smoothedHeadingRef.current = rawHeading;
      } else {
        // Take shortest angular path
        let delta = rawHeading - prev;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        smoothedHeadingRef.current = (prev + delta * 0.4 + 360) % 360;
      }
    }

    map.easeTo({
      center: [pos.lng, pos.lat],
      bearing: smoothedHeadingRef.current ?? map.getBearing(),
      // Don't override zoom on every position update — it causes the map to
      // randomly snap back to 17 while the user is navigating.
      duration: 600,
      essential: true,
    });
  }, [pos, followMode]);

  // When entering/leaving followMode, set pitch/zoom ONCE so subsequent
  // position updates don't keep snapping the camera back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (followMode) {
        userInteractingRef.current = false;
        // Lazily add 3D buildings the first time the driver enters navigation
        if (!map.getLayer('3d-buildings')) {
          try {
            const layers = map.getStyle().layers || [];
            const labelLayer = layers.find((l: any) => l.type === 'symbol' && l.layout?.['text-field']);
            const compositeSource = map.getStyle().sources?.composite;
            if (compositeSource) {
              map.addLayer(
                {
                  id: '3d-buildings',
                  source: 'composite',
                  'source-layer': 'building',
                  filter: ['==', 'extrude', 'true'],
                  type: 'fill-extrusion',
                  minzoom: 14,
                  paint: {
                    'fill-extrusion-color': isDaytime() ? '#d6d6d6' : '#2a3340',
                    'fill-extrusion-height': [
                      'interpolate', ['linear'], ['zoom'],
                      14, 0,
                      15.5, ['get', 'height'],
                    ],
                    'fill-extrusion-base': [
                      'interpolate', ['linear'], ['zoom'],
                      14, 0,
                      15.5, ['get', 'min_height'],
                    ],
                    'fill-extrusion-opacity': 0.65,
                  },
                },
                labelLayer?.id,
              );
            }
          } catch { /* no-op */ }
        }

        map.easeTo({ pitch: 55, zoom: Math.max(map.getZoom(), 17), duration: 600 });
      } else {
        smoothedHeadingRef.current = null;
        map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
      }
    };
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
  }, [followMode]);



  // Store marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    storeMarkerRef.current?.remove();
    storeMarkerRef.current = null;
    if (storeLat != null && storeLng != null) {
      const el = document.createElement('div');
      const isTarget = navigatingTo === 'store';
      el.innerHTML = `<div style="width:40px;height:40px;background:${isTarget ? '#f97316' : '#f97316'};border-radius:14px;border:3px solid white;box-shadow:0 2px 16px rgba(249,115,22,0.5);display:flex;align-items:center;justify-content:center;font-size:20px;${isTarget ? 'animation:bounce 1s infinite;' : ''}">🏪</div>`;
      storeMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([storeLng, storeLat])
        .setPopup(new mapboxgl.Popup({ offset: 24 }).setHTML(`<strong style="font-size:13px;">${escapeHtml(storeName || 'Κατάστημα')}</strong>`))
        .addTo(map);
    }
  }, [storeLat, storeLng, storeName, navigatingTo]);

  // Customer marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    customerMarkerRef.current?.remove();
    customerMarkerRef.current = null;
    if (customerLat != null && customerLng != null) {
      const el = document.createElement('div');
      const isTarget = navigatingTo === 'customer';
      el.innerHTML = `<div style="width:40px;height:40px;background:#22c55e;border-radius:14px;border:3px solid white;box-shadow:0 2px 16px rgba(34,197,94,0.5);display:flex;align-items:center;justify-content:center;font-size:20px;${isTarget ? 'animation:bounce 1s infinite;' : ''}">📍</div>`;
      customerMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([customerLng, customerLat])
        .setPopup(new mapboxgl.Popup({ offset: 24 }).setHTML(`<strong style="font-size:13px;">${escapeHtml(customerName || 'Παράδοση')}</strong><br/><span style="font-size:11px;">${escapeHtml(customerAddress || '')}</span>`))
        .addTo(map);
    }
  }, [customerLat, customerLng, customerName, customerAddress, navigatingTo]);

  // Nearby stores markers (admin-toggleable)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const incoming = nearbyStores ?? [];
    const incomingIds = new Set(incoming.map(s => s.id));

    // Remove markers no longer in list
    nearbyMarkersRef.current.forEach((marker, id) => {
      if (!incomingIds.has(id)) {
        marker.remove();
        nearbyMarkersRef.current.delete(id);
      }
    });

    // Add or update
    incoming.forEach(s => {
      // Don't show a nearby pin where the active store/customer pin already is
      if (storeLat != null && storeLng != null
          && Math.abs(storeLat - s.latitude) < 1e-5
          && Math.abs(storeLng - s.longitude) < 1e-5) {
        const existing = nearbyMarkersRef.current.get(s.id);
        if (existing) { existing.remove(); nearbyMarkersRef.current.delete(s.id); }
        return;
      }

      const safeName = escapeHtml(s.name);
      const initials = String(s.name).split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '🏪';
      const safeInitials = escapeHtml(initials);
      const hasOrders = s.pendingOrders > 0;
      const ringColor = hasOrders ? '#f97316' : '#cbd5e1';
      const badge = hasOrders
        ? `<div style="position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;background:#ef4444;color:#fff;border-radius:9px;border:2px solid #fff;font-size:10px;font-weight:800;line-height:1;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;box-shadow:0 2px 6px rgba(239,68,68,0.5);">${s.pendingOrders}</div>`
        : '';
      const safeImg = safeHttpsUrl(s.image_url);
      const imgInner = safeImg
        ? `<img src="${safeImg}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none'" />`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:12px;background:linear-gradient(135deg,#f97316,#ea580c);border-radius:50%;font-family:system-ui,sans-serif;">${safeInitials}</div>`;

      const html = `
        <div style="position:relative;cursor:pointer;width:44px;height:52px;">
          <div style="position:absolute;top:0;left:0;width:44px;height:44px;border-radius:50%;padding:2.5px;background:${ringColor};box-shadow:0 4px 12px rgba(0,0,0,0.25);">
            <div style="width:100%;height:100%;border-radius:50%;background:#fff;padding:1.5px;box-sizing:border-box;">
              <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:#1f2937;">${imgInner}</div>
            </div>
          </div>
          <div style="position:absolute;left:50%;top:40px;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid ${ringColor};filter:drop-shadow(0 2px 2px rgba(0,0,0,0.2));"></div>
          ${badge}
        </div>`;

      const existing = nearbyMarkersRef.current.get(s.id);
      if (existing) {
        existing.getElement().innerHTML = html;
        existing.setLngLat([s.longitude, s.latitude]);
      } else {
        const el = document.createElement('div');
        el.innerHTML = html;
        const popupContent = `<strong style="font-size:13px;">${safeName}</strong><br/><span style="font-size:11px;color:#6b7280;">${s.pendingOrders} ενεργ${s.pendingOrders === 1 ? 'ή' : 'ές'} παραγγελί${s.pendingOrders === 1 ? 'α' : 'ες'}</span>`;
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([s.longitude, s.latitude])
          .setPopup(new mapboxgl.Popup({ offset: 8 }).setHTML(popupContent))
          .addTo(map);
        nearbyMarkersRef.current.set(s.id, marker);
      }
    });
  }, [nearbyStores, storeLat, storeLng]);

  // Fetch & draw route
  const fetchRoute = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !token || !pos || !navigatingTo) {
      // Clear route
      if (map?.getSource('route')) {
        (map.getSource('route') as mapboxgl.GeoJSONSource).setData({
          type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {},
        });
      }
      onRouteUpdate?.(null);
      return;
    }

    let destLat: number | null = null;
    let destLng: number | null = null;
    if (navigatingTo === 'store' && storeLat != null && storeLng != null) {
      destLat = storeLat; destLng = storeLng;
    } else if (navigatingTo === 'customer' && customerLat != null && customerLng != null) {
      destLat = customerLat; destLng = customerLng;
    }
    if (destLat == null || destLng == null) return;

    // Round driver pos to ~110m so small GPS jitter doesn't keep invalidating the route
    const routeKey = `${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}-${destLat},${destLng}`;
    if (routeKey === lastRouteKey.current) return;
    lastRouteKey.current = routeKey;

    // Cache hit: reuse a recent route response instead of hitting Mapbox again.
    const cached = routeCacheRef.current.get(routeKey);
    let data: any | null = cached && (Date.now() - cached.at) < ROUTE_CACHE_TTL_MS ? cached.data : null;

    if (!data) {
      routeFetchRef.current?.abort();
      const ctrl = new AbortController();
      routeFetchRef.current = ctrl;
      try {
        // Use driving-traffic for live traffic-aware ETA + congestion annotations
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${pos.lng},${pos.lat};${destLng},${destLat}?geometries=geojson&overview=full&steps=true&annotations=congestion,duration&access_token=${token}`;
        const res = await fetch(url, { signal: ctrl.signal });
        data = await res.json();
        routeCacheRef.current.set(routeKey, { at: Date.now(), data });
        // Trim cache to last 20 entries
        if (routeCacheRef.current.size > 20) {
          const firstKey = routeCacheRef.current.keys().next().value;
          if (firstKey) routeCacheRef.current.delete(firstKey);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('Route fetch error:', e);
        return;
      }
    }

    try {
      const route = data.routes?.[0];
      if (!route) return;

      const coords = route.geometry.coordinates;
      const congestion: string[] = route.legs?.[0]?.annotation?.congestion || [];


      if (map.getSource('route')) {
        (map.getSource('route') as mapboxgl.GeoJSONSource).setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { congestion },
        });

        // Build a gradient along line-progress from congestion buckets
        if (congestion.length && coords.length > 1) {
          const colorFor = (c: string) => {
            switch (c) {
              case 'severe': return '#dc2626';
              case 'heavy': return '#f97316';
              case 'moderate': return '#facc15';
              case 'low': return '#22c55e';
              default: return '#22c55e';
            }
          };
          const stops: any[] = ['interpolate', ['linear'], ['line-progress']];
          const n = congestion.length;
          for (let i = 0; i < n; i++) {
            const t = i / n;
            stops.push(t, colorFor(congestion[i]));
          }
          stops.push(1, colorFor(congestion[n - 1]));
          try {
            map.setPaintProperty('route-line', 'line-gradient', stops as any);
          } catch {/* layer may not be ready */}
        }
      }

      // Fit route — skip while in followMode so we don't fight the follow camera
      if (!followModeRef.current) {
        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach((c: [number, number]) => bounds.extend(c));
        bounds.extend([pos.lng, pos.lat]);
        map.fitBounds(bounds, { padding: { top: 80, bottom: 200, left: 50, right: 50 }, maxZoom: 16 });
      }


      // Parse steps with maneuver detail for in-app turn-by-turn UI
      const steps: RouteStep[] = route.legs[0]?.steps?.map((s: any) => ({
        instruction: s.maneuver?.instruction || '',
        distance: s.distance,
        duration: s.duration,
        maneuverType: s.maneuver?.type,
        modifier: s.maneuver?.modifier,
        location: s.maneuver?.location as [number, number] | undefined,
        name: s.name || undefined,
      })) || [];

      onRouteUpdate?.({
        distance: route.distance,
        duration: route.duration,
        steps,
      });
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error('Route fetch error:', e);
    }
  }, [pos, navigatingTo, storeLat, storeLng, customerLat, customerLng, token, onRouteUpdate]);

  // Fetch route on change — fire fast on destination/nav change, then keep route fresh
  // without resetting the timer on every GPS tick (which used to delay routes indefinitely).
  const fetchRouteRef = useRef(fetchRoute);
  useEffect(() => { fetchRouteRef.current = fetchRoute; }, [fetchRoute]);

  // Immediate fetch when destination or navigation target changes
  useEffect(() => {
    const t = setTimeout(() => fetchRouteRef.current(), 150);
    return () => clearTimeout(t);
  }, [navigatingTo, storeLat, storeLng, customerLat, customerLng, token]);

  // Periodic refresh while navigating (every 8s) instead of on every GPS update
  useEffect(() => {
    if (!navigatingTo) return;
    const id = setInterval(() => fetchRouteRef.current(), 8000);
    return () => clearInterval(id);
  }, [navigatingTo]);

  // Clear route when not navigating
  useEffect(() => {
    if (!navigatingTo) {
      const map = mapRef.current;
      if (map?.getSource('route')) {
        (map.getSource('route') as mapboxgl.GeoJSONSource).setData({
          type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {},
        });
      }
      onRouteUpdate?.(null);
      lastRouteKey.current = '';
    }
  }, [navigatingTo]);

  // Expose recenter method
  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pos) return;
    // Resume follow camera tracking after a manual pan/zoom
    userInteractingRef.current = false;
    if (followModeRef.current) {
      map.easeTo({
        center: [pos.lng, pos.lat],
        bearing: smoothedHeadingRef.current ?? pos.heading ?? 0,
        pitch: 55,
        zoom: Math.max(map.getZoom(), 17),
        duration: 800,
        essential: true,
      });
    } else {
      map.flyTo({ center: [pos.lng, pos.lat], zoom: 15, duration: 800 });
    }
  }, [pos]);

  const focusOn = useCallback((target: 'store' | 'customer') => {
    const map = mapRef.current;
    if (!map) return;
    const lat = target === 'store' ? storeLat : customerLat;
    const lng = target === 'store' ? storeLng : customerLng;
    if (lat == null || lng == null) return;

    if (pos) {
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([pos.lng, pos.lat]);
      bounds.extend([lng, lat]);
      map.fitBounds(bounds, { padding: { top: 120, bottom: 260, left: 60, right: 60 }, maxZoom: 16, duration: 800 });
    } else {
      map.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
    }
  }, [storeLat, storeLng, customerLat, customerLng, pos]);

  useImperativeHandle(ref, () => ({ recenter, focusOn }), [recenter, focusOn]);

  if (loading || !token) {
    return (
      <div className={`bg-muted/50 flex items-center justify-center ${className}`}>
        <div className="h-6 w-6 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <div ref={mapContainer} className={className} style={{ minHeight: '200px' }} />;
});

export default DriverMapbox;
