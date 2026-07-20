import { useEffect, useRef } from 'react';
import { useDriverAppPrefs } from '@/hooks/useDriverAppPrefs';
import { useTheme } from '@/hooks/useTheme';
import { useI18n } from '@/lib/i18n';

interface Props {
  isOnline: boolean;
  onForceOffline: () => void;
  hasActiveDelivery: boolean;
}

/**
 * Headless component that applies driver app preferences as live side effects:
 *  - Syncs theme & language with global providers on mount
 *  - Wake Lock when keepScreenOn is enabled
 *  - Auto-offline after N minutes of inactivity
 */
export function DriverPrefsApplier({ isOnline, onForceOffline, hasActiveDelivery }: Props) {
  const prefs = useDriverAppPrefs();
  const { setTheme, theme } = useTheme();
  const { setLang, lang } = useI18n();

  // Sync theme/lang once on mount if prefs differ from globals.
  useEffect(() => {
    if (prefs.theme && prefs.theme !== theme) setTheme(prefs.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (prefs.language && prefs.language !== lang) setLang(prefs.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wake Lock — keep screen on while online
  const wakeLockRef = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        const nav = navigator as any;
        if (!prefs.keepScreenOn || !isOnline || !nav.wakeLock) return;
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) { lock.release?.(); return; }
        wakeLockRef.current = lock;
        lock.addEventListener?.('release', () => { wakeLockRef.current = null; });
      } catch { /* permissions / unsupported */ }
    }
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [prefs.keepScreenOn, isOnline]);

  // Inactivity auto-offline
  useEffect(() => {
    if (!isOnline || hasActiveDelivery) return;
    const minutes = prefs.inactivityMinutes ?? 0;
    if (!minutes || minutes <= 0) return;
    let timer: number | null = null;
    const reset = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => onForceOffline(), minutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'visibilitychange'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [isOnline, hasActiveDelivery, prefs.inactivityMinutes, onForceOffline]);

  return null;
}
