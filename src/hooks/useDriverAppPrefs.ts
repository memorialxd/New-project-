import { useEffect, useState } from 'react';
import { loadDriverAppPrefs, type DriverAppPrefs } from '@/lib/driver-app-prefs';

export function useDriverAppPrefs(): DriverAppPrefs {
  const [prefs, setPrefs] = useState<DriverAppPrefs>(() => loadDriverAppPrefs());
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DriverAppPrefs>).detail;
      setPrefs(detail ?? loadDriverAppPrefs());
    };
    const storageHandler = () => setPrefs(loadDriverAppPrefs());
    window.addEventListener('driver-app-prefs-changed', handler);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('driver-app-prefs-changed', handler);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);
  return prefs;
}
