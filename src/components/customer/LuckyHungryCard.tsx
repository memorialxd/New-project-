import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

type Pick = {
  id: string;
  name: string;
  price: number;
  store_id: string;
  original: number;
};

/**
 * "Η Τυχερή Πεινιάτα" — daily countdown deal card.
 * Source: cheapest available item from each store that the admin has
 * marked as `promotion_status = 'active'`. Countdown ends at midnight.
 */
export default function LuckyHungryCard() {
  const navigate = useNavigate();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [remaining, setRemaining] = useState<string>('');

  // Countdown to next midnight
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(24, 0, 0, 0);
      const diff = Math.max(0, end.getTime() - now.getTime());
      const h = Math.floor(diff / 3600_000);
      const m = Math.floor((diff % 3600_000) / 60_000);
      setRemaining(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const nowIso = new Date().toISOString();
      const { data: promoted } = await (supabase as any)
        .from('stores_public')
        .select('id')
        .eq('is_active', true)
        .eq('promotion_status', 'active')
        .or(`promotion_ends_at.is.null,promotion_ends_at.gte.${nowIso}`)
        .limit(20);
      const storeIds = (promoted ?? []).map((s: any) => s.id);
      if (!storeIds.length) {
        if (!cancel) setPicks([]);
        return;
      }
      const { data: items } = await supabase
        .from('menu_items')
        .select('id, name, price, store_id')
        .in('store_id', storeIds)
        .eq('is_available', true)
        .eq('is_snoozed', false)
        .order('price', { ascending: true })
        .limit(60);
      const seen = new Set<string>();
      const list: Pick[] = [];
      for (const it of items ?? []) {
        if (seen.has(it.store_id)) continue;
        seen.add(it.store_id);
        list.push({
          id: it.id,
          name: it.name,
          price: Number(it.price),
          store_id: it.store_id,
          original: +(Number(it.price) * 1.5).toFixed(0),
        });
        if (list.length >= 3) break;
      }
      if (!cancel) setPicks(list);
    })();
    return () => { cancel = true; };
  }, []);

  if (picks.length < 1) return null;

  return (
    <section className="px-5 pt-5">
      <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[hsl(258,55%,93%)] to-[hsl(258,60%,88%)] p-4 shadow-[0_8px_24px_-12px_hsl(258_40%_30%/0.25)] ring-1 ring-[hsl(258,40%,80%)]/40">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-9 w-9 rounded-full bg-white flex items-center justify-center text-lg shrink-0 shadow-sm">🦄</span>
            <h2 className="font-heading font-extrabold text-[16px] text-[hsl(258,50%,25%)] truncate">
              Η Τυχερή Πεινιάτα
            </h2>
          </div>
          <span className="bg-[hsl(258,55%,35%)] text-white rounded-lg px-2.5 py-1 text-[12px] font-extrabold tabular-nums shadow-[0_2px_6px_-1px_hsl(258_55%_25%/0.5)]">
            {remaining}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {picks.map((p, i) => {
            const highlight = i === 0;
            return (
              <button
                key={p.id}
                onClick={() => navigate(`/restaurant/${p.store_id}`)}
                className={`relative rounded-2xl p-3 text-left transition-all active:scale-95 ${
                  highlight
                    ? 'bg-[hsl(258,55%,35%)] text-white shadow-[0_4px_12px_-3px_hsl(258_55%_25%/0.4)]'
                    : 'bg-white text-[hsl(258,50%,25%)] shadow-sm'
                }`}
              >
                <div className={`text-[10px] font-bold ${highlight ? 'text-white/70' : 'text-[hsl(258,30%,50%)]'}`}>
                  Από <span className="line-through">{p.original}€</span>
                </div>
                <div className={`text-[15px] font-extrabold leading-tight mt-0.5 tabular-nums ${highlight ? '' : ''}`}>
                  {highlight && <span className="block text-[10px] font-bold mb-0.5 opacity-90">Μόνο</span>}
                  {p.price.toFixed(2).replace('.', ',')}€
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
