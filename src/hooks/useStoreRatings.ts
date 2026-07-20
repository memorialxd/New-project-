import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StoreRating {
  avg: number;
  count: number;
}

/**
 * Fetches aggregate ratings (average + count) for a list of store IDs.
 * Stable, order-independent dedup key prevents refetch storms when the
 * caller passes a new array reference each render (e.g. filtered lists
 * recomputed on every keystroke).
 */
export function useStoreRatings(storeIds: string[]) {
  const [ratings, setRatings] = useState<Record<string, StoreRating>>({});

  const key = useMemo(
    () => [...new Set(storeIds)].sort().join(','),
    [storeIds.join('|')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!key) {
      setRatings({});
      return;
    }
    const ids = key.split(',');
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('reviews')
        .select('store_id, rating')
        .in('store_id', ids);
      if (cancelled || !data) return;
      const map: Record<string, { sum: number; count: number }> = {};
      for (const r of data) {
        if (!map[r.store_id]) map[r.store_id] = { sum: 0, count: 0 };
        map[r.store_id].sum += r.rating;
        map[r.store_id].count += 1;
      }
      const result: Record<string, StoreRating> = {};
      for (const id of ids) {
        const m = map[id];
        result[id] = m ? { avg: +(m.sum / m.count).toFixed(1), count: m.count } : { avg: 0, count: 0 };
      }
      setRatings(result);
    })();
    return () => { cancelled = true; };
  }, [key]);

  return ratings;
}
