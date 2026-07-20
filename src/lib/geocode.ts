export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formatted: string;
}

/** In-memory cache for the current session (shared across calls). */
const memCache = new Map<string, GeocodeResult | null>();
const LS_PREFIX = 'geo:v2:';

function readLS(key: string): GeocodeResult | null | undefined {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch { return undefined; }
}
function writeLS(key: string, val: GeocodeResult | null) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* quota */ }
}

/** No-op kept for backwards compat with old DriverApp boot warmup. */
export function warmMapboxToken(): void { /* Google API is invoked on demand */ }

/**
 * Forward-geocode an address via the secure `google-geocode` edge function
 * (Google Geocoding API, biased to Greece). Cached in memory + localStorage.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const q = address?.trim();
  if (!q) return null;
  const key = q.toLowerCase();

  if (memCache.has(key)) return memCache.get(key) ?? null;
  const cached = readLS(key);
  if (cached !== undefined) {
    memCache.set(key, cached);
    return cached;
  }

  let result: GeocodeResult | null = null;
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data, error } = await supabase.functions.invoke('google-geocode', {
      body: { q },
    });
    if (!error) {
      result = (data as any)?.result ?? null;
    }
  } catch { result = null; }

  memCache.set(key, result);
  writeLS(key, result);
  return result;
}

/** Haversine distance in km between two coordinates. */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
