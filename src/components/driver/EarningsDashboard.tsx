import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, ChevronDown, Package, MapPin, ShoppingBag, Clock, Receipt, Navigation } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDriverAppPrefs } from '@/hooks/useDriverAppPrefs';
import { format, startOfDay, endOfDay, addDays, isSameDay, isToday, isYesterday, getISOWeek } from 'date-fns';
import { el } from 'date-fns/locale';
import { shortenAddress } from '@/lib/address-utils';

interface EarningRow {
  id: string;
  base_pay: number;
  tip: number | null;
  bonus: number | null;
  total: number | null;
  created_at: string;
  order_id: string | null;
  orders: {
    id: string;
    created_at: string;
    store_id: string;
    delivery_address: string | null;
    distance_km: number | null;
    stores: { name: string | null } | null;
    order_items: { quantity: number }[] | null;
  } | null;
}

const dayLabel = (d: Date) => {
  if (isToday(d)) return 'Σήμερα';
  if (isYesterday(d)) return 'Χθες';
  return format(d, 'EEE d MMM', { locale: el }).replace('.', '');
};

export function EarningsDashboard() {
  const { user } = useAuth();
  const { hideEarningsOnHome } = useDriverAppPrefs();
  const mask = (v: string) => (hideEarningsOnHome ? '••••' : v);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [rows, setRows] = useState<EarningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [incomeOpen, setIncomeOpen] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    (async () => {
      const from = startOfDay(selectedDate).toISOString();
      const to = endOfDay(selectedDate).toISOString();
      const { data } = await supabase
        .from('earnings')
        .select('id, base_pay, tip, bonus, total, created_at, order_id, orders:order_id(id, created_at, store_id, delivery_address, distance_km, stores:store_id(name), order_items(quantity))')
        .eq('driver_id', user.id)
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false });
      if (active) {
        setRows((data ?? []) as unknown as EarningRow[]);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user?.id, selectedDate]);

  const totals = useMemo(() => {
    const base = rows.reduce((s, e) => s + Number(e.base_pay ?? 0), 0);
    const tip = rows.reduce((s, e) => s + Number(e.tip ?? 0), 0);
    const bonus = rows.reduce((s, e) => s + Number(e.bonus ?? 0), 0);
    const total = rows.reduce((s, e) => s + Number(e.total ?? base + tip + bonus), 0);
    const income = total - tip; // ό,τι δεν είναι tip
    return { base, tip, bonus, total, income };
  }, [rows]);

  // Hours = sum of (earnings.created_at - order.created_at) for rows with order
  const workMinutes = useMemo(() => {
    let mins = 0;
    rows.forEach((r) => {
      if (r.orders?.created_at) {
        const start = new Date(r.orders.created_at).getTime();
        const end = new Date(r.created_at).getTime();
        const m = Math.max(0, (end - start) / 60_000);
        if (m < 240) mins += m; // ignore unrealistic >4h
      }
    });
    return Math.round(mins);
  }, [rows]);

  const avgPerHour = workMinutes > 0 ? (totals.total / (workMinutes / 60)) : 0;
  const hoursLabel = `${Math.floor(workMinutes / 60)}Ω ${String(workMinutes % 60).padStart(2, '0')}Λ`;

  // Group deliveries by store, keeping individual delivery rows
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; name: string; total: number; first: Date; last: Date; count: number; deliveries: EarningRow[] }>();
    rows.forEach((r) => {
      const key = r.orders?.store_id ?? `other-${r.id}`;
      const name = r.orders?.stores?.name ?? 'Άγνωστο κατάστημα';
      const t = new Date(r.created_at);
      const existing = map.get(key);
      if (existing) {
        existing.total += Number(r.total ?? 0);
        existing.count += 1;
        existing.deliveries.push(r);
        if (t < existing.first) existing.first = t;
        if (t > existing.last) existing.last = t;
      } else {
        map.set(key, { key, name, total: Number(r.total ?? 0), first: t, last: t, count: 1, deliveries: [r] });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.last.getTime() - a.last.getTime());
  }, [rows]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const completedCount = rows.length;
  const weekNo = getISOWeek(selectedDate);
  const yearNo = selectedDate.getFullYear();
  const isFuture = startOfDay(selectedDate) >= startOfDay(addDays(new Date(), 1));

  return (
    <div className="space-y-3">
      {/* Day pager */}
      <div className="relative rounded-2xl bg-card border border-[hsl(var(--driver-border))] px-4 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedDate((d) => addDays(d, -1))}
            className="h-9 w-9 rounded-full border border-[hsl(var(--driver-border))] flex items-center justify-center text-[hsl(var(--driver-text-muted))] hover:bg-[hsl(var(--driver-surface))] active:scale-95 transition"
            aria-label="Προηγούμενη"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-center">
            <p className="font-heading font-bold text-lg text-[hsl(var(--driver-text))] leading-tight">
              {dayLabel(selectedDate)}
            </p>
            <p className="text-[11px] text-[hsl(var(--driver-text-muted))] mt-0.5">
              Εβδομάδα {weekNo} · {yearNo}
            </p>
          </div>
          <button
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
            disabled={isFuture}
            className="h-9 w-9 rounded-full border border-[hsl(var(--driver-border))] flex items-center justify-center text-[hsl(var(--driver-text-muted))] hover:bg-[hsl(var(--driver-surface))] active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Επόμενη"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Total + breakdown */}
      <div className="rounded-2xl bg-card border border-[hsl(var(--driver-border))] p-5 space-y-4">
        <div>
          <p className="text-sm text-[hsl(var(--driver-text-muted))] font-heading">Σύνολο</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="font-heading font-extrabold text-3xl tabular-nums text-[hsl(var(--driver-text))]">
              {loading ? '—' : mask(`${totals.total.toFixed(2).replace('.', ',')} €`)}
            </p>
            <Info className="h-4 w-4 text-[hsl(var(--driver-text-muted))]" />
          </div>
        </div>

        <div className="border-t border-[hsl(var(--driver-border))] pt-3">
          <button
            onClick={() => setIncomeOpen((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <span className="font-heading font-bold text-[15px] text-[hsl(var(--driver-text))]">Συνολικό εισόδημα</span>
            <span className="flex items-center gap-2">
              <span className="font-heading font-bold text-[15px] tabular-nums text-[hsl(var(--driver-text))]">
                {mask(`${totals.income.toFixed(2).replace('.', ',')} €`)}
              </span>
              <ChevronDown className={`h-4 w-4 text-[hsl(var(--driver-text-muted))] transition-transform ${incomeOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {incomeOpen && (
            <div className="mt-2 space-y-1.5 pl-1">
              <div className="flex justify-between text-[13px] text-[hsl(var(--driver-text-muted))]">
                <span>Βασικά</span>
                <span className="tabular-nums">{mask(`${totals.base.toFixed(2).replace('.', ',')} €`)}</span>
              </div>
              {totals.bonus > 0 && (
                <div className="flex justify-between text-[13px] text-[hsl(var(--driver-text-muted))]">
                  <span>Μπόνους</span>
                  <span className="tabular-nums">{mask(`${totals.bonus.toFixed(2).replace('.', ',')} €`)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[hsl(var(--driver-border))] pt-3 flex items-center justify-between">
          <span className="font-heading font-bold text-[15px] text-[hsl(var(--driver-text))]">Tip</span>
          <span className="font-heading font-bold text-[15px] tabular-nums text-[hsl(var(--driver-text))]">
            {mask(`${totals.tip.toFixed(2).replace('.', ',')} €`)}
          </span>
        </div>
      </div>

      {/* Avg/h + Hours */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[hsl(var(--driver-surface))] border border-[hsl(var(--driver-border))] p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[12px] text-[hsl(var(--driver-text-muted))]">Μέσος όρος ανά ώρα</p>
            <Info className="h-3 w-3 text-[hsl(var(--driver-text-muted))]" />
          </div>
          <p className="font-heading font-bold text-xl tabular-nums text-[hsl(var(--driver-text))]">
            {mask(`${avgPerHour.toFixed(2).replace('.', ',')} €`)}
          </p>
        </div>
        <div className="rounded-2xl bg-[hsl(var(--driver-surface))] border border-[hsl(var(--driver-border))] p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[12px] text-[hsl(var(--driver-text-muted))]">Ώρες</p>
            <Info className="h-3 w-3 text-[hsl(var(--driver-text-muted))]" />
          </div>
          <p className="font-heading font-bold text-xl tabular-nums text-[hsl(var(--driver-text))]">{hoursLabel}</p>
        </div>
      </div>

      {/* Deliveries */}
      <div className="pt-2">
        <h3 className="font-heading font-extrabold text-lg text-[hsl(var(--driver-text))] mb-1">Παραδόσεις</h3>
        <p className="text-[13px] text-[hsl(var(--driver-text-muted))] mb-3">
          <span className="font-bold text-[hsl(var(--driver-text))]">{completedCount}</span> Ολοκληρωμένη
        </p>

        {loading ? (
          <div className="py-8 text-center text-[hsl(var(--driver-text-muted))] text-sm">Φόρτωση…</div>
        ) : grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--driver-border))] py-10 text-center text-[hsl(var(--driver-text-muted))] text-sm">
            Καμία παράδοση {isSameDay(selectedDate, new Date()) ? 'σήμερα' : 'αυτή τη μέρα'}
          </div>
        ) : (
          <div className="rounded-2xl bg-card border border-[hsl(var(--driver-border))] divide-y divide-[hsl(var(--driver-border))]">
            {grouped.map((g) => {
              const isOpen = expanded.has(g.key);
              return (
                <div key={g.key}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(g.key)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left active:bg-[hsl(var(--driver-surface))] transition"
                  >
                    <div className="h-9 w-9 rounded-lg bg-[hsl(var(--driver-accent))]/10 flex items-center justify-center shrink-0">
                      <Package className="h-4 w-4 text-[hsl(var(--driver-accent))]" strokeWidth={2.25} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-heading font-bold text-[14px] text-[hsl(var(--driver-text))] truncate uppercase">
                          {g.name}
                        </p>
                        <p className="font-heading font-extrabold text-[14px] text-[hsl(var(--driver-accent))] tabular-nums shrink-0">
                          {mask(`${g.total.toFixed(2).replace('.', ',')} €`)}
                        </p>
                      </div>
                      <p className="text-[12px] text-[hsl(var(--driver-text-muted))] mt-0.5">
                        {format(g.first, 'HH:mm')} - {format(g.last, 'HH:mm')}
                      </p>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-[11px] text-[hsl(var(--driver-text-muted))]">
                          Παραγγελία/ες: {g.count} {g.count === 1 ? 'παράδοση' : 'παραδόσεις'}
                        </p>
                        <ChevronDown className={`h-4 w-4 text-[hsl(var(--driver-text-muted))] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="bg-[hsl(var(--driver-surface))]/60 px-4 py-3 space-y-3">
                      {g.deliveries.map((d) => {
                        const items = d.orders?.order_items ?? [];
                        const itemsCount = items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
                        const base = Number(d.base_pay ?? 0);
                        const tip = Number(d.tip ?? 0);
                        const bonus = Number(d.bonus ?? 0);
                        const total = Number(d.total ?? base + tip + bonus);
                        const addr = shortenAddress(d.orders?.delivery_address ?? '');
                        const dist = d.orders?.distance_km;
                        return (
                          <div key={d.id} className="rounded-xl bg-card border border-[hsl(var(--driver-border))] p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[12px] text-[hsl(var(--driver-text-muted))]">
                                <Clock className="h-3.5 w-3.5" />
                                <span className="tabular-nums">{format(new Date(d.created_at), 'HH:mm')}</span>
                                {d.orders?.created_at && (
                                  <span className="tabular-nums">
                                    · {Math.max(1, Math.round((new Date(d.created_at).getTime() - new Date(d.orders.created_at).getTime()) / 60000))} λ
                                  </span>
                                )}
                              </div>
                              <span className="font-heading font-extrabold text-[14px] text-[hsl(var(--driver-accent))] tabular-nums">
                                {mask(`${total.toFixed(2).replace('.', ',')} €`)}
                              </span>
                            </div>

                            {addr && (
                              <div className="flex items-start gap-1.5 text-[12px] text-[hsl(var(--driver-text))]">
                                <MapPin className="h-3.5 w-3.5 mt-0.5 text-[hsl(var(--driver-text-muted))] shrink-0" />
                                <span className="line-clamp-2">{addr}</span>
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[hsl(var(--driver-text-muted))]">
                              <span className="inline-flex items-center gap-1">
                                <ShoppingBag className="h-3 w-3" /> {itemsCount} {itemsCount === 1 ? 'προϊόν' : 'προϊόντα'}
                              </span>
                              {typeof dist === 'number' && (
                                <span className="inline-flex items-center gap-1">
                                  <Navigation className="h-3 w-3" /> {dist.toFixed(1).replace('.', ',')} χλμ
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1">
                                <Receipt className="h-3 w-3" /> #{(d.order_id ?? '').slice(0, 6).toUpperCase()}
                              </span>
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[hsl(var(--driver-border))]">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--driver-text-muted))]">Βασικά</p>
                                <p className="font-heading font-bold text-[13px] tabular-nums text-[hsl(var(--driver-text))]">{mask(`${base.toFixed(2).replace('.', ',')} €`)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--driver-text-muted))]">Tip</p>
                                <p className="font-heading font-bold text-[13px] tabular-nums text-[hsl(var(--driver-text))]">{mask(`${tip.toFixed(2).replace('.', ',')} €`)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--driver-text-muted))]">Μπόνους</p>
                                <p className="font-heading font-bold text-[13px] tabular-nums text-[hsl(var(--driver-text))]">{mask(`${bonus.toFixed(2).replace('.', ',')} €`)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
