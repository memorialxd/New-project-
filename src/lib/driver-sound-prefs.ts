import popAsset from '@/assets/sounds/pop.mp3.asset.json';
import honkAsset from '@/assets/sounds/honk.mp3.asset.json';
import partyAsset from '@/assets/sounds/party.mp3.asset.json';
import screechAsset from '@/assets/sounds/screech.mp3.asset.json';
import suspenseAsset from '@/assets/sounds/suspense.mp3.asset.json';
import mysteryAsset from '@/assets/sounds/mystery.mp3.asset.json';
import whistleAsset from '@/assets/sounds/whistle.mp3.asset.json';
import clownAsset from '@/assets/sounds/clown.mp3.asset.json';
import nokiaAsset from '@/assets/sounds/nokia.mp3.asset.json';
import slipAsset from '@/assets/sounds/slip.mp3.asset.json';

export type SoundPattern =
  | 'pop'
  | 'honk'
  | 'party'
  | 'screech'
  | 'suspense'
  | 'mystery'
  | 'whistle'
  | 'clown'
  | 'nokia'
  | 'slip';

export interface DriverSoundPrefs {
  enabled: boolean;
  volume: number;        // 0..1
  pattern: SoundPattern;
  repeatCount: number;   // 1..5
  vibrate: boolean;
}

const KEY = 'qg.driver.sound.prefs.v2';

const DEFAULTS: DriverSoundPrefs = {
  enabled: true,
  volume: 0.85,
  pattern: 'pop',
  repeatCount: 2,
  vibrate: true,
};

const PATTERN_MIGRATIONS: Record<string, SoundPattern> = {
  fresh: 'pop', bell: 'party', pulse: 'pop', cash: 'party', zen: 'mystery',
  alert: 'honk', doordash: 'pop', doordash_real: 'pop', doordash_style: 'pop',
  ios_tritone: 'mystery', pristine: 'party', crystal: 'party', tesla: 'pop',
  fanfare: 'party', wolt: 'pop', uber: 'pop', glovo: 'pop',
  kaching: 'party', arcade: 'pop', marimba: 'mystery', classic_phone: 'nokia',
  siren: 'honk', chime: 'party', urgent: 'honk',
};

const VALID: SoundPattern[] = ['pop','honk','party','screech','suspense','mystery','whistle','clown','nokia','slip'];

const SOUND_URLS: Record<SoundPattern, string> = {
  pop: popAsset.url,
  honk: honkAsset.url,
  party: partyAsset.url,
  screech: screechAsset.url,
  suspense: suspenseAsset.url,
  mystery: mysteryAsset.url,
  whistle: whistleAsset.url,
  clown: clownAsset.url,
  nokia: nokiaAsset.url,
  slip: slipAsset.url,
};

export function loadDriverSoundPrefs(): DriverSoundPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // try legacy key migration
      const legacy = localStorage.getItem('qg.driver.sound.prefs.v1');
      if (legacy) {
        const parsedLegacy = { ...DEFAULTS, ...JSON.parse(legacy) } as DriverSoundPrefs;
        if (!VALID.includes(parsedLegacy.pattern)) {
          parsedLegacy.pattern = PATTERN_MIGRATIONS[parsedLegacy.pattern as string] ?? 'pop';
        }
        return parsedLegacy;
      }
      return DEFAULTS;
    }
    const parsed = { ...DEFAULTS, ...JSON.parse(raw) } as DriverSoundPrefs;
    if (!VALID.includes(parsed.pattern)) {
      parsed.pattern = PATTERN_MIGRATIONS[parsed.pattern as string] ?? 'pop';
    }
    return parsed;
  } catch {
    return DEFAULTS;
  }
}

export function saveDriverSoundPrefs(prefs: DriverSoundPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('driver-sound-prefs-changed', { detail: prefs }));
}

// Audio element cache — one per pattern, reused so we don't refetch each play.
const audioCache: Partial<Record<SoundPattern, HTMLAudioElement>> = {};
function getAudio(pattern: SoundPattern): HTMLAudioElement {
  let el = audioCache[pattern];
  if (!el) {
    el = new Audio(SOUND_URLS[pattern]);
    el.preload = 'auto';
    audioCache[pattern] = el;
  }
  return el;
}

export function primeDriverAudio() {
  if (typeof window === 'undefined') return;
  // Touch each audio element so the browser whitelists playback within this gesture.
  try {
    VALID.forEach((p) => {
      const el = getAudio(p);
      el.muted = true;
      const pr = el.play();
      if (pr && typeof pr.then === 'function') {
        pr.then(() => { el.pause(); el.currentTime = 0; el.muted = false; }).catch(() => { el.muted = false; });
      } else {
        el.pause(); el.currentTime = 0; el.muted = false;
      }
    });
  } catch {}
}

let unlockListenersInstalled = false;
function installAudioUnlockListeners() {
  if (typeof window === 'undefined' || unlockListenersInstalled) return;
  unlockListenersInstalled = true;
  const unlock = () => {
    primeDriverAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}
installAudioUnlockListeners();

export function playPattern(pattern: SoundPattern, volume: number) {
  try {
    const el = getAudio(pattern);
    el.pause();
    el.currentTime = 0;
    el.volume = Math.max(0, Math.min(1, volume));
    void el.play().catch(() => {});
    return (el.duration && isFinite(el.duration)) ? el.duration * 1000 : 1200;
  } catch (e) {
    console.warn('sound play failed', e);
    return 0;
  }
}

let _alertLockUntil = 0;
const _pendingTimers: number[] = [];

export function playOfferAlert(prefs?: DriverSoundPrefs) {
  const p = prefs ?? loadDriverSoundPrefs();
  if (!p.enabled) return;
  const now = Date.now();
  if (now < _alertLockUntil) return;
  const reps = Math.max(1, p.repeatCount);
  _alertLockUntil = now + reps * 1400 + 400;
  while (_pendingTimers.length) { try { clearTimeout(_pendingTimers.pop()!); } catch {} }
  if (p.vibrate && 'vibrate' in navigator) {
    try { navigator.vibrate([120, 80, 120]); } catch {}
  }
  playPattern(p.pattern, p.volume);
  for (let i = 1; i < reps; i++) {
    const t = window.setTimeout(() => playPattern(p.pattern, p.volume), i * 1400);
    _pendingTimers.push(t);
  }
}

export function stopOfferAlert() {
  while (_pendingTimers.length) { try { clearTimeout(_pendingTimers.pop()!); } catch {} }
  _alertLockUntil = 0;
  // Pause any currently playing audio elements
  try {
    Object.values(audioCache).forEach((el) => {
      if (!el) return;
      try { el.pause(); el.currentTime = 0; } catch {}
    });
  } catch {}
  if ('vibrate' in navigator) {
    try { navigator.vibrate(0); } catch {}
  }
}
