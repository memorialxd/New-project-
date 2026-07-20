// Per-device driver app preferences (stored in localStorage)

export type DriverTheme = 'dark' | 'light' | 'system';
export type DriverLanguage = 'el' | 'en';
export type DistanceUnit = 'km' | 'mi';
export type NavApp = 'google' | 'apple' | 'waze';

export interface DriverAppPrefs {
  theme: DriverTheme;
  language: DriverLanguage;
  distanceUnit: DistanceUnit;
  navApp: NavApp;
  keepScreenOn: boolean;
  autoAcceptHighValue: boolean;
  hideEarningsOnHome: boolean;
  showStorePinsOnMap: boolean;
  inactivityMinutes: number; // 0 = never
}

const KEY = 'driver_app_prefs_v1';

const DEFAULTS: DriverAppPrefs = {
  theme: 'dark',
  language: 'el',
  distanceUnit: 'km',
  navApp: 'google',
  keepScreenOn: false,
  autoAcceptHighValue: false,
  hideEarningsOnHome: false,
  showStorePinsOnMap: true,
  inactivityMinutes: 30,
};

export function loadDriverAppPrefs(): DriverAppPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveDriverAppPrefs(prefs: DriverAppPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('driver-app-prefs-changed', { detail: prefs }));
  } catch {}
}
