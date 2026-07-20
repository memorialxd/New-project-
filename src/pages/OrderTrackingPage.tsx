import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, ChevronUp, ChevronDown, Package, Utensils, CheckCircle2, Car, MapPin, Star, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { ReviewForm } from '@/components/ReviewForm';
import LiveTrackingMap from '@/components/customer/LiveTrackingMap';
import { PostDeliveryTipCard } from '@/components/customer/PostDeliveryTipCard';
import { SEO } from '@/components/SEO';
import { formatOrderNumber } from '@/lib/order-number';

type OrderRow = Database['public']['Tables']['orders']['Row'];
type OrderItemRow = Database['public']['Tables']['order_items']['Row'];

const DELIVERY_BUFFER_MIN = 15;

const STATUS_STEPS = [
  { key: 'placed', label: 'Στάλθηκε', icon: Package },
  { key: 'accepted', label: 'Αποδεκτή', icon: CheckCircle2 },
  { key: 'preparing', label: 'Ετοιμάζεται', icon: Utensils },
  { key: 'ready', label: 'Έτοιμη', icon: Package },
  { key: 'picked_up', label: 'Στο δρόμο', icon: Car },
  { key: 'delivered', label: 'Παραδόθηκε', icon: MapPin },
] as const;

const STATUS_HEADLINE: Record<string, { emoji: string; title: string; sub: string }> = {
  placed:     { emoji: '📋', title: 'Στείλαμε την παραγγελία σου', sub: 'Περιμένουμε επιβεβαίωση από το κατάστημα' },
  accepted:   { emoji: '👨‍🍳', title: 'Το κατάστημα την αποδέχτηκε', sub: 'Ξεκινάει η ετοιμασία' },
  preparing:  { emoji: '🔥', title: 'Ετοιμάζεται φρέσκο', sub: 'Σύντομα θα είναι έτοιμη' },
  ready:      { emoji: '✅', title: 'Έτοιμη για παραλαβή', sub: 'Ψάχνουμε οδηγό' },
  arrived:    { emoji: '🏪', title: 'Ο οδηγός στο κατάστημα', sub: 'Παραλαμβάνει την παραγγελία' },
  picked_up:  { emoji: '🛵', title: 'Ο οδηγός έρχεται!', sub: 'Παρακολούθησε ζωντανά την πορεία' },
  delivered:  { emoji: '🎉', title: 'Παραδόθηκε', sub: 'Καλή όρεξη!' },
  cancelled:  { emoji: '❌', title: 'Ακυρώθηκε', sub: 'Η παραγγελία ακυρώθηκε' },
};

export default function OrderTrackingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [storeName, setStoreName] = useState('');
  const [storeLat, setStoreLat] = useState<number | null>(null);
  const [storeLng, setStoreLng] = useState<number | null>(null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [driverPhone, setDriverPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showThankYou, setShowThankYou] = useState(false);
  const [thankYouCountdown, setThankYouCountdown] = useState(6);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      supabase.from('orders').select('*').eq('id', id).single(),
      supabase.from('order_items').select('*').eq('order_id', id),
    ]).then(async ([oRes, iRes]) => {
      if (oRes.data) {
        setOrder(oRes.data);
        const { data: s } = await (supabase as any)
          .from('stores_public')
          .select('name, latitude, longitude')
          .eq('id', oRes.data.store_id)
          .maybeSingle();
        if (s) { setStoreName(s.name); setStoreLat(s.latitude); setStoreLng(s.longitude); }
        if (oRes.data.driver_id) {
          const { data: p } = await supabase.from('profiles').select('full_name, phone').eq('user_id', oRes.data.driver_id).single();
          if (p) { setDriverName(p.full_name); setDriverPhone(p.phone); }
        }
        const { data: rev } = await supabase.from('reviews').select('id').eq('order_id', oRes.data.id).maybeSingle();
        if (rev) setHasReviewed(true);
      }
      setItems(iRes.data ?? []);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`order-track-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, async (p) => {
        const updated = p.new as OrderRow;
        setOrder((prev) => (prev ? { ...prev, ...updated } : prev));
        if (updated.driver_id && !driverName) {
          const { data: pr } = await supabase.from('profiles').select('full_name, phone').eq('user_id', updated.driver_id).single();
          if (pr) { setDriverName(pr.full_name); setDriverPhone(pr.phone); }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, driverName]);

  // When order becomes delivered → celebrate + auto navigate away
  useEffect(() => {
    if (order?.status !== 'delivered') return;
    setShowThankYou(true);
  }, [order?.status]);

  useEffect(() => {
    if (!showThankYou) return;
    setThankYouCountdown(6);
    const tick = setInterval(() => {
      setThankYouCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    const done = setTimeout(() => navigate('/orders'), 6000);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, [showThankYou, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-heading">Η παραγγελία δεν βρέθηκε</p>
      </div>
    );
  }

  const status = order.status ?? 'placed';
  const headline = STATUS_HEADLINE[status] ?? STATUS_HEADLINE.placed;
  const isDelivered = status === 'delivered';
  const isCancelled = status === 'cancelled';
  const currentIdx = STATUS_STEPS.findIndex((s) => s.key === status);

  // ETA
  const prepMin = order.estimated_prep_time ?? 30;
  const totalMin = prepMin + DELIVERY_BUFFER_MIN;
  const startTs = new Date(order.created_at).getTime();
  const endTs = startTs + totalMin * 60_000;
  const remainingMin = Math.max(0, Math.ceil((endTs - now) / 60_000));

  const showMap = !isCancelled && !isDelivered;

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <SEO
        title={`Παρακολούθηση παραγγελίας ${formatOrderNumber(order as any)} — Fresh Delivery`}
        description="Παρακολουθήστε την παραγγελία σας σε πραγματικό χρόνο, δείτε την εκτιμώμενη ώρα παράδοσης και επικοινωνήστε με τον οδηγό."
        path={`/order-tracking/${order.id}`}
        noindex
      />

      {/* Thank-you overlay after delivery */}
      {showThankYou && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center px-8 text-center animate-in fade-in duration-500"
          style={{ background: 'linear-gradient(180deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.85) 100%)' }}
        >
          <div className="text-8xl mb-6 animate-bounce">🎉</div>
          <h1 className="font-heading font-extrabold text-4xl text-primary-foreground mb-3">
            Ευχαριστούμε!
          </h1>
          <p className="text-primary-foreground/90 font-heading text-lg mb-1">
            Η παραγγελία σου παραδόθηκε
          </p>
          <p className="text-primary-foreground/70 text-sm mb-10">
            Καλή σου όρεξη 🍽️
          </p>
          <Button
            onClick={() => navigate('/orders')}
            className="bg-card text-foreground hover:bg-card/90 font-heading font-bold rounded-full px-8 h-12 shadow-lg"
          >
            Κλείσιμο ({thankYouCountdown})
          </Button>
        </div>
      )}

      {/* Map background */}
      {showMap ? (
        <LiveTrackingMap
          driverId={order.driver_id}
          storeLat={storeLat}
          storeLng={storeLng}
          deliveryLat={order.delivery_latitude}
          deliveryLng={order.delivery_longitude}
          status={status}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-background flex items-center justify-center">
          <span className="text-[120px] opacity-20">{headline.emoji}</span>
        </div>
      )}

      {/* Top floating bar */}
      <header
        className="absolute top-0 left-0 right-0 z-30 px-4 pt-3 pb-2 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <button
          onClick={() => navigate('/orders')}
          aria-label="Επιστροφή στις παραγγελίες μου"
          className="h-11 w-11 rounded-full bg-card/95 backdrop-blur-md shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className="bg-card/95 backdrop-blur-md shadow-lg rounded-full px-4 py-2 flex items-center gap-2">
          {!isCancelled && !isDelivered && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
          )}
          <span className="text-xs font-bold text-foreground tabular-nums">{formatOrderNumber(order as any)}</span>
        </div>
      </header>

      {/* Bottom sheet */}
      <div
        className="absolute left-0 right-0 bottom-0 z-30 bg-card rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.15)] transition-[max-height] duration-300 ease-out flex flex-col"
        style={{
          maxHeight: sheetExpanded ? '85vh' : '46vh',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Drag handle */}
        <button
          onClick={() => setSheetExpanded((v) => !v)}
          className="w-full pt-2.5 pb-1 flex flex-col items-center"
        >
          <span className="h-1.5 w-12 rounded-full bg-muted" />
        </button>

        <div className="overflow-y-auto px-5 pb-5 flex-1">
          {/* Headline + ETA */}
          <div className="pt-1 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{headline.emoji}</span>
                  <h1 className="font-heading font-extrabold text-lg text-foreground leading-tight">{headline.title}</h1>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{headline.sub}</p>
              </div>
              {!isCancelled && !isDelivered && (
                <div className="text-right shrink-0 gradient-primary rounded-2xl px-4 py-2.5 shadow-primary">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary-foreground/80">ETA</p>
                  <p className="font-heading font-extrabold text-2xl text-primary-foreground tabular-nums leading-none mt-0.5">
                    {remainingMin}<span className="text-xs font-bold ml-0.5 opacity-80">λεπ</span>
                  </p>
                </div>
              )}
            </div>

            {/* Progress dots */}
            {!isCancelled && (
              <div className="mt-4 flex items-center gap-1.5">
                {STATUS_STEPS.map((s, i) => {
                  const done = i <= currentIdx;
                  const current = i === currentIdx;
                  return (
                    <div
                      key={s.key}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                        done ? 'bg-primary' : 'bg-muted'
                      } ${current && !isDelivered ? 'animate-pulse' : ''}`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Driver card */}
          {order.driver_id && !isDelivered && !isCancelled && (
            <div className="mt-2 rounded-2xl border border-border bg-background/60 p-3 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full gradient-primary flex items-center justify-center shrink-0 text-primary-foreground font-heading font-extrabold text-lg">
                {(driverName?.[0] ?? 'Ο').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-sm text-foreground truncate">{driverName ?? 'Ο οδηγός σου'}</p>
                <p className="text-xs text-muted-foreground">Οδηγός παράδοσης</p>
              </div>
              <div className="flex items-center gap-2">
                {driverPhone && (
                  <a
                    href={`tel:${driverPhone}`}
                    className="h-11 w-11 rounded-full bg-success/15 text-success flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <Phone className="h-5 w-5" />
                  </a>
                )}
                <button
                  onClick={() => navigate('/support')}
                  className="h-11 w-11 rounded-full bg-primary/15 text-primary flex items-center justify-center active:scale-95 transition-transform"
                >
                  <MessageCircle className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

          {/* Store row */}
          {storeName && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-background/60 border border-border p-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Utensils className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider font-extrabold text-muted-foreground">Από</p>
                <p className="font-heading font-bold text-sm text-foreground truncate">{storeName}</p>
              </div>
            </div>
          )}

          {/* Expand toggle hint */}
          {!sheetExpanded && (
            <button
              onClick={() => setSheetExpanded(true)}
              className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs font-bold text-muted-foreground py-2"
            >
              Λεπτομέρειες παραγγελίας <ChevronUp className="h-4 w-4" />
            </button>
          )}

          {/* Expanded content */}
          {sheetExpanded && (
            <>
              {/* Timeline */}
              {!isCancelled && (
                <div className="mt-5">
                  <h3 className="font-heading font-bold text-sm text-foreground mb-3">Πρόοδος</h3>
                  <div>
                    {STATUS_STEPS.map((s, i) => {
                      const Icon = s.icon;
                      const done = i <= currentIdx;
                      const current = i === currentIdx;
                      return (
                        <div key={s.key} className="flex items-start gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                              done ? 'gradient-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            } ${current && !isDelivered ? 'ring-4 ring-primary/20 scale-110' : ''}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            {i < STATUS_STEPS.length - 1 && (
                              <div className={`w-0.5 h-6 ${i < currentIdx ? 'bg-primary' : 'bg-muted'}`} />
                            )}
                          </div>
                          <div className="pb-4 flex-1">
                            <p className={`font-heading font-semibold text-sm ${done ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Order summary */}
              <div className="mt-4 rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-heading font-bold text-sm text-foreground">Παραγγελία</h3>
                  <button
                    type="button"
                    onClick={async () => {
                      const lines: string[] = [];
                      lines.push(`Παραγγελία ${formatOrderNumber(order as any)}`);
                      if (storeName) lines.push(`Από: ${storeName}`);
                      lines.push(new Date(order.created_at).toLocaleString('el-GR'));
                      lines.push('');
                      items.forEach((i) => {
                        lines.push(`${i.quantity}× ${i.name} — €${(Number(i.unit_price) * i.quantity).toFixed(2)}`);
                      });
                      lines.push('');
                      if (order.delivery_fee) lines.push(`Παράδοση: €${Number(order.delivery_fee).toFixed(2)}`);
                      if (order.tip_amount) lines.push(`Φιλοδώρημα: €${Number(order.tip_amount).toFixed(2)}`);
                      lines.push(`Σύνολο: €${Number(order.total_amount).toFixed(2)}`);
                      if (order.delivery_address) { lines.push(''); lines.push(`Διεύθυνση: ${order.delivery_address}`); }
                      if (order.notes) lines.push(`Σημείωση: ${order.notes}`);
                      const text = lines.join('\n');
                      try {
                        await navigator.clipboard.writeText(text);
                        toast.success('Αντιγράφηκε');
                      } catch {
                        toast.error('Αποτυχία αντιγραφής');
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold text-primary active:scale-95 transition-transform"
                  >
                    <Copy className="h-3.5 w-3.5" /> Αντιγραφή
                  </button>
                </div>
                {items.map((item) => (
                  <div key={item.id} className="flex justify-between py-1.5 text-sm">
                    <span className="text-foreground">{item.quantity}× {item.name}</span>
                    <span className="text-muted-foreground tabular-nums">€{(Number(item.unit_price) * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 mt-2 border-t border-border font-heading font-extrabold">
                  <span className="text-foreground">Σύνολο</span>
                  <span className="text-foreground tabular-nums">€{Number(order.total_amount).toFixed(2)}</span>
                </div>
                {order.delivery_address && (
                  <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>{order.delivery_address}</span>
                  </div>
                )}
              </div>


              {isDelivered && order.driver_id && (
                <div className="mt-4">
                  <PostDeliveryTipCard
                    orderId={order.id}
                    driverId={order.driver_id}
                    driverName={driverName}
                    initialTip={Number(order.tip_amount ?? 0)}
                  />
                </div>
              )}

              {isDelivered && !hasReviewed && (
                <div className="mt-4">
                  <ReviewForm orderId={order.id} storeId={order.store_id} onSubmitted={() => setHasReviewed(true)} />
                </div>
              )}
              {isDelivered && hasReviewed && (
                <div className="mt-4 rounded-2xl bg-success/5 border border-success/20 p-4 text-center">
                  <Star className="h-6 w-6 fill-warning text-warning mx-auto mb-1" />
                  <p className="font-heading text-sm text-foreground">Ευχαριστούμε για την κριτική!</p>
                </div>
              )}

              <Button onClick={() => navigate('/orders')} variant="outline" className="w-full font-heading mt-4">
                Οι παραγγελίες μου
              </Button>

              <button
                onClick={() => setSheetExpanded(false)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-bold text-muted-foreground py-2"
              >
                Σύμπτυξη <ChevronDown className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
