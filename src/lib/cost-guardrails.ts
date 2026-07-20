// Cost guardrails — client-side kill switches, hard caps and a
// self-throttling daily budget meter so Lovable Cloud / AI / Storage
// can never quietly blow up the bill.
//
// All state is in localStorage and broadcast via a custom event so any
// open tab / component reacts instantly.

import { useEffect, useState } from 'react';

// ---------- Types ----------

export type CostGuardrails = {
  // Master panic switch — disables every non-essential paid service
  panicMode: boolean;

  // ----- Budget (the new self-throttling part) -----
  /** Hard ceiling for *credits-equivalent* spend per UTC day. */
  dailyBudgetCredits: number;
  /** % of budget at which we start soft-throttling (warn + drop nice-to-haves). */
  softThrottlePct: number; // e.g. 75
  /** When true, hitting 100 % of the budget flips panicMode automatically. */
  autoPanicOnBudget: boolean;

  // ----- Lovable AI -----
  aiEnabled: boolean;
  aiDailyCallCap: number;
  aiPreferCheapModel: boolean;

  // ----- Realtime / DB writes -----
  realtimeLocationsEnabled: boolean;
  driverLocationIntervalSec: number;
  pushNotificationsEnabled: boolean;

  // ----- Storage -----
  storageUploadsEnabled: boolean;
  maxUploadMb: number;
  imageCompression: boolean;
};

export const DEFAULT_GUARDRAILS: CostGuardrails = {
  panicMode: false,

  dailyBudgetCredits: 5,   // matches the daily cap shown in Cloud usage
  softThrottlePct: 75,
  autoPanicOnBudget: true,

  aiEnabled: true,
  aiDailyCallCap: 500,
  aiPreferCheapModel: true,

  realtimeLocationsEnabled: true,
  driverLocationIntervalSec: 15,
  pushNotificationsEnabled: true,

  storageUploadsEnabled: true,
  maxUploadMb: 5,
  imageCompression: true,
};

const KEY = 'cost_guardrails_v1';
const EVT = 'cost-guardrails:changed';
const AI_COUNTER_KEY = 'cost_ai_counter_v1';
const USAGE_KEY = 'cost_usage_meter_v1';

// ---------- Settings load / save ----------

export function loadGuardrails(): CostGuardrails {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_GUARDRAILS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_GUARDRAILS;
}

export function saveGuardrails(next: Partial<CostGuardrails>): CostGuardrails {
  const merged = { ...loadGuardrails(), ...next };
  localStorage.setItem(KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent(EVT, { detail: merged }));
  return merged;
}

export function useGuardrails(): CostGuardrails {
  const [g, setG] = useState<CostGuardrails>(loadGuardrails);
  useEffect(() => {
    const onChange = () => setG(loadGuardrails());
    window.addEventListener(EVT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return g;
}

/** Effective flags after applying panicMode + budget overrides. */
export function effective(g: CostGuardrails) {
  const budgetTripped = isBudgetExceeded(g);
  const panic = g.panicMode || (g.autoPanicOnBudget && budgetTripped);
  if (panic) {
    return {
      ...g,
      panicMode: true,
      aiEnabled: false,
      realtimeLocationsEnabled: false,
      pushNotificationsEnabled: false,
      storageUploadsEnabled: false,
    };
  }
  // Soft throttle: above the soft pct we kill the most expensive
  // nice-to-haves (AI + realtime locations) but keep core flows up.
  if (isSoftThrottled(g)) {
    return {
      ...g,
      aiEnabled: false,
      realtimeLocationsEnabled: false,
      aiPreferCheapModel: true,
    };
  }
  return g;
}

// ---------- AI call counter (per UTC day) ----------
type Counter = { day: string; count: number };
function todayKey() { return new Date().toISOString().slice(0, 10); }

export function getAiCallsToday(): number {
  try {
    const raw = localStorage.getItem(AI_COUNTER_KEY);
    if (!raw) return 0;
    const c: Counter = JSON.parse(raw);
    return c.day === todayKey() ? c.count : 0;
  } catch { return 0; }
}

/** Call before invoking AI. Returns false if blocked. */
export function tryConsumeAiCall(): { ok: boolean; reason?: string } {
  const g = effective(loadGuardrails());
  if (!g.aiEnabled) return { ok: false, reason: 'AI απενεργοποιημένο από τα Cost Guardrails' };
  const used = getAiCallsToday();
  if (used >= g.aiDailyCallCap) {
    return { ok: false, reason: `Έφτασες το όριο ${g.aiDailyCallCap} κλήσεων/ημέρα` };
  }
  const next: Counter = { day: todayKey(), count: used + 1 };
  localStorage.setItem(AI_COUNTER_KEY, JSON.stringify(next));
  // Charge the budget — AI calls are the most expensive single op.
  chargeBudget('ai', 0.01);
  return { ok: true };
}

export function resetAiCounter() {
  localStorage.removeItem(AI_COUNTER_KEY);
}

// ---------- Self-throttling daily budget meter ----------
//
// We can't see real Cloud billing from the client, so we approximate it:
// every paid-ish operation (AI call, DB write, realtime msg, storage MB)
// records a small *credit cost* into a per-day meter. The Money Engine
// panel shows live spend, and once the meter hits the user-set cap we
// either soft-throttle or auto-panic.

export type UsageBucket = 'ai' | 'db' | 'realtime' | 'storage';

type UsageMeter = {
  day: string;
  buckets: Record<UsageBucket, number>; // credits spent
};

function emptyMeter(): UsageMeter {
  return { day: todayKey(), buckets: { ai: 0, db: 0, realtime: 0, storage: 0 } };
}

function loadMeter(): UsageMeter {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return emptyMeter();
    const m: UsageMeter = JSON.parse(raw);
    if (m.day !== todayKey()) return emptyMeter();
    return { ...emptyMeter(), ...m, buckets: { ...emptyMeter().buckets, ...m.buckets } };
  } catch { return emptyMeter(); }
}

function persistMeter(m: UsageMeter) {
  localStorage.setItem(USAGE_KEY, JSON.stringify(m));
  window.dispatchEvent(new CustomEvent(EVT));
}

export function chargeBudget(bucket: UsageBucket, credits: number) {
  if (credits <= 0) return;
  const m = loadMeter();
  m.buckets[bucket] = (m.buckets[bucket] || 0) + credits;
  persistMeter(m);
}

export function getUsageToday(): { total: number; buckets: Record<UsageBucket, number> } {
  const m = loadMeter();
  const total = Object.values(m.buckets).reduce((a, b) => a + b, 0);
  return { total, buckets: m.buckets };
}

export function resetUsageMeter() {
  localStorage.removeItem(USAGE_KEY);
  window.dispatchEvent(new CustomEvent(EVT));
}

export function isBudgetExceeded(g: CostGuardrails = loadGuardrails()): boolean {
  return getUsageToday().total >= g.dailyBudgetCredits;
}

export function isSoftThrottled(g: CostGuardrails = loadGuardrails()): boolean {
  const pct = (getUsageToday().total / Math.max(g.dailyBudgetCredits, 0.0001)) * 100;
  return pct >= g.softThrottlePct && pct < 100;
}

// Convenience hook so panels re-render as the meter ticks.
export function useUsageMeter() {
  const [m, setM] = useState(getUsageToday);
  useEffect(() => {
    const tick = () => setM(getUsageToday());
    window.addEventListener(EVT, tick);
    window.addEventListener('storage', tick);
    const i = setInterval(tick, 5000);
    return () => {
      window.removeEventListener(EVT, tick);
      window.removeEventListener('storage', tick);
      clearInterval(i);
    };
  }, []);
  return m;
}

// ---------- Helpers for callers ----------

/** Wrap a DB write to charge the budget. Cheap per-write estimate. */
export function chargeDbWrite(rows = 1) {
  chargeBudget('db', 0.00005 * rows);
}
/** Wrap a realtime msg dispatch. */
export function chargeRealtime(msgs = 1) {
  chargeBudget('realtime', 0.00002 * msgs);
}
/** Wrap a storage upload (MB). */
export function chargeStorage(mb: number) {
  chargeBudget('storage', 0.001 * mb);
}
