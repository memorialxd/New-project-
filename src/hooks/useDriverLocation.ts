import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

// Dynamic push cadence: stationary drivers push rarely (saves battery + network);
// moving drivers push often (dispatcher needs accuracy). Tuned per GPS speed.
const TICK_MS = 2_000;             // scheduler tick (cheap)
const MIN_INTERVAL_STATIONARY = 15_000;
const MIN_INTERVAL_SLOW = 8_000;
const MIN_INTERVAL_FAST = 4_000;
const MIN_MOVE_M = 8;              // don't re-send if position barely changed


interface NormalizedPos {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
}

const isNative = Capacitor.isNativePlatform();

export function useDriverLocation(isActive: boolean) {
  const { user } = useAuth();
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lastPosRef = useRef<NormalizedPos | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const sendLocation = useCallback(async (pos: NormalizedPos) => {
    if (!user) return;
    // If we're offline, just keep the latest pos in lastPosRef and bail —
    // the 'online' listener (and the next interval tick) will flush it.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      lastPosRef.current = pos;
      return;
    }
    try {
      await supabase
        .from('driver_locations')
        .upsert(
          {
            driver_id: user.id,
            latitude: pos.latitude,
            longitude: pos.longitude,
            heading: pos.heading,
            speed: pos.speed,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'driver_id' }
        );
    } catch {
      // Network blip — keep last pos for next tick / online event
      lastPosRef.current = pos;
    }
  }, [user]);

  // Hard-offline: clear our location row so the dispatcher immediately
  // stops considering us online. ONLY used when the driver explicitly
  // toggles offline — not on tab close / background, so a driver who
  // momentarily loses signal or backgrounds the app stays online.
  const goHardOffline = useCallback(async () => {
    if (!user) return;
    try {
      await supabase.from('driver_locations').delete().eq('driver_id', user.id);
    } catch {
      /* swallow */
    }
  }, [user]);

  useEffect(() => {
    if (!isActive || !user) {
      cleanupRef.current?.();
      cleanupRef.current = null;
      lastPosRef.current = null;
      setTracking(false);
      // Driver explicitly toggled offline (isActive=false) — clear row.
      void goHardOffline();
      return;
    }

    let cancelled = false;
    setError(null);

    const start = async () => {
      try {
        if (isNative) {
          // Request fine-grained permission on native
          const perm = await Geolocation.requestPermissions({ permissions: ['location'] });
          if (perm.location !== 'granted') {
            setError('Δεν δόθηκε άδεια τοποθεσίας');
            return;
          }
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 15000 },
            (pos, err) => {
              if (err) {
                setError(err.message);
                return;
              }
              if (!pos) return;
              lastPosRef.current = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                speed: pos.coords.speed ?? null,
                heading: pos.coords.heading ?? null,
              };
            }
          );
          if (cancelled) {
            await Geolocation.clearWatch({ id });
            return;
          }
          watchIdRef.current = id;
        } else {
          if (!('geolocation' in navigator)) {
            setError('Geolocation not supported');
            return;
          }
          const id = navigator.geolocation.watchPosition(
            (pos) => {
              lastPosRef.current = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                speed: pos.coords.speed ?? null,
                heading: pos.coords.heading ?? null,
              };
            },
            (err) => { setError(err.message); setTracking(false); },
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
          );
          watchIdRef.current = id;
        }

        setTracking(true);

        // Throttled push loop. Wakes every TICK_MS but only actually upserts
        // when (a) enough time has passed for the driver's current speed and
        // (b) the position moved more than MIN_MOVE_M from the last push.
        let lastSentAt = 0;
        let lastSentPos: NormalizedPos | null = null;
        const distanceM = (a: NormalizedPos, b: NormalizedPos) => {
          const dLat = (b.latitude - a.latitude) * 111_000;
          const dLng = (b.longitude - a.longitude) * 111_000 * Math.cos(a.latitude * Math.PI / 180);
          return Math.hypot(dLat, dLng);
        };
        const intervalForSpeed = (speedMps: number | null) => {
          if (speedMps == null || speedMps < 0.5) return MIN_INTERVAL_STATIONARY;
          if (speedMps < 5) return MIN_INTERVAL_SLOW; // walking / urban crawl
          return MIN_INTERVAL_FAST;                   // driving
        };
        intervalRef.current = window.setInterval(async () => {
          let pos = lastPosRef.current;
          if (!pos) {
            try {
              if (isNative) {
                const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
                pos = {
                  latitude: p.coords.latitude,
                  longitude: p.coords.longitude,
                  speed: p.coords.speed ?? null,
                  heading: p.coords.heading ?? null,
                };
                lastPosRef.current = pos;
              } else {
                return; // wait for watchPosition callback
              }
            } catch {
              return;
            }
          }
          if (!pos) return;
          const now = Date.now();
          const minInterval = intervalForSpeed(pos.speed);
          const moved = lastSentPos ? distanceM(lastSentPos, pos) : Infinity;
          if (now - lastSentAt < minInterval && moved < MIN_MOVE_M) return;
          lastSentAt = now;
          lastSentPos = pos;
          sendLocation(pos);
        }, TICK_MS);


        cleanupRef.current = () => {
          if (watchIdRef.current !== null) {
            if (isNative) {
              Geolocation.clearWatch({ id: watchIdRef.current as string }).catch(() => {});
            } else {
              navigator.geolocation.clearWatch(watchIdRef.current as number);
            }
            watchIdRef.current = null;
          }
          if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        };
      } catch (e: any) {
        setError(e?.message ?? 'Σφάλμα τοποθεσίας');
      }
    };

    start();

    // When connectivity is restored, immediately flush the latest position
    // so the dispatcher sees us as online again without waiting for the
    // next 5s tick.
    const handleOnline = () => {
      if (lastPosRef.current) void sendLocation(lastPosRef.current);
    };
    window.addEventListener('online', handleOnline);

    // NOTE: We intentionally do NOT clear the driver's location row on
    // pagehide / beforeunload. If the driver closes or backgrounds the
    // app while online, they stay online — the row TTL / heartbeat
    // freshness check on the dispatcher side handles true disconnects.

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      window.removeEventListener('online', handleOnline);
    };
  }, [isActive, user, sendLocation, goHardOffline]);

  return { tracking, error };
}
