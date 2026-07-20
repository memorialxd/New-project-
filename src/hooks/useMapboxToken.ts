import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const ENV_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

const LS_KEY = 'mapbox_token_v1';
const LS_TS_KEY = 'mapbox_token_ts_v1';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

let cachedToken: string | null = ENV_TOKEN || null;
let inflight: Promise<string | null> | null = null;

function readLocal(): string | null {
  try {
    const t = localStorage.getItem(LS_KEY);
    const ts = Number(localStorage.getItem(LS_TS_KEY) ?? 0);
    if (t && Date.now() - ts < TTL_MS) return t;
  } catch { /* ignore */ }
  return null;
}

function writeLocal(t: string) {
  try {
    localStorage.setItem(LS_KEY, t);
    localStorage.setItem(LS_TS_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

export function prefetchMapboxToken(): Promise<string | null> {
  if (cachedToken) return Promise.resolve(cachedToken);
  const local = readLocal();
  if (local) {
    cachedToken = local;
    return Promise.resolve(local);
  }
  if (inflight) return inflight;
  inflight = supabase.functions.invoke('get-mapbox-token').then(({ data, error }) => {
    inflight = null;
    if (!error && data?.token) {
      cachedToken = data.token;
      writeLocal(data.token);
      return data.token;
    }
    return null;
  }).catch(() => { inflight = null; return null; });
  return inflight;
}

export function useMapboxToken() {
  const initial = cachedToken ?? readLocal();
  if (initial && !cachedToken) cachedToken = initial;
  const [token, setToken] = useState<string | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) return;
    prefetchMapboxToken().then((t) => {
      if (t) setToken(t);
      setLoading(false);
    });
  }, []);

  return { token, loading };
}
