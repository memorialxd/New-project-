import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, Trash2, MapPin, ShoppingBag, Tag, CheckCircle2, X, Banknote, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { SavedAddresses } from '@/components/SavedAddresses';
import ScheduledDeliveryPicker from '@/components/customer/ScheduledDeliveryPicker';
import { OrderCheckout } from '@/components/OrderCheckout';
import { PaymentTestModeBanner } from '@/components/PaymentTestModeBanner';
import { isPaymentsConfigured } from '@/lib/stripe';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SEO } from '@/components/SEO';

interface AppliedPromo {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { items, storeId, storeName, total, itemCount, updateQuantity, removeItem, clearCart } = useCart();
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0.99);

  useEffect(() => {
    (supabase as any).rpc('get_platform_settings_public')
      .then(({ data }: any) => {
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.platform_service_fee != null) {
          setDeliveryFee(Number(row.platform_service_fee));
        }
      });
  }, []);

  // Prefill address — first try the customer's saved default address,
  // otherwise fall back to whatever they typed on the home page (stored
  // locally as `customer_delivery_address`).
  useEffect(() => {
    // Local fallback runs immediately so the field is never empty when
    // the customer already set an address on home.
    try {
      const local = localStorage.getItem('customer_delivery_address');
      if (local && !address) setAddress(local);
      const coordsRaw = localStorage.getItem('customer_delivery_coords');
      if (coordsRaw && !deliveryCoords) {
        const parsed = JSON.parse(coordsRaw);
        if (parsed?.lat && parsed?.lon) setDeliveryCoords({ lat: parsed.lat, lon: parsed.lon });
      }
    } catch {}

    if (!user) return;
    supabase
      .from('saved_addresses')
      .select('address, latitude, longitude')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAddress((data as any).address);
          if ((data as any).latitude && (data as any).longitude) {
            setDeliveryCoords({ lat: (data as any).latitude, lon: (data as any).longitude });
          }
        }
      });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notes, setNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const cardEnabled = isPaymentsConfigured();
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>(cardEnabled ? 'card' : 'cash');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  // Tip defaults to 0 — customers opt in explicitly.
  const [tipOption, setTipOption] = useState<number | 'custom'>(0);
  const [customTip, setCustomTip] = useState('');

  const subtotalAfterDiscount = Math.max(0, total - (appliedPromo
    ? appliedPromo.discount_type === 'percentage'
      ? Math.min(total, total * (appliedPromo.discount_value / 100))
      : Math.min(total, appliedPromo.discount_value)
    : 0));

  const tipAmount = tipOption === 'custom'
    ? Math.max(0, parseFloat(customTip) || 0)
    : subtotalAfterDiscount * (tipOption / 100);

  const discount = appliedPromo
    ? appliedPromo.discount_type === 'percentage'
      ? Math.min(total, total * (appliedPromo.discount_value / 100))
      : Math.min(total, appliedPromo.discount_value)
    : 0;
  const grandTotal = subtotalAfterDiscount + deliveryFee + tipAmount;

  // VAT (ΦΠΑ) breakdown — Greek food delivery VAT 24%. Prices are inclusive.
  const VAT_RATE = 0.24;
  // Tip is excluded from VAT (paid directly to driver)
  const vatableGross = subtotalAfterDiscount + deliveryFee;
  const netAmount = vatableGross / (1 + VAT_RATE);
  const vatAmount = vatableGross - netAmount;

  const handleApplyPromo = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoLoading(true);

    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .ilike('code', code)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      toast.error('Μη έγκυρος κωδικός προσφοράς');
      setPromoLoading(false);
      return;
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      toast.error('Αυτός ο κωδικός έχει λήξει');
      setPromoLoading(false);
      return;
    }

    if (data.max_uses !== null && data.current_uses >= data.max_uses) {
      toast.error('Αυτός ο κωδικός έχει εξαντληθεί');
      setPromoLoading(false);
      return;
    }

    if (total < Number(data.min_order_amount)) {
      toast.error(`Ελάχιστη παραγγελία ${Number(data.min_order_amount).toFixed(2)}€`);
      setPromoLoading(false);
      return;
    }

    if (data.store_id && data.store_id !== storeId) {
      toast.error('Αυτός ο κωδικός δεν ισχύει για αυτό το εστιατόριο');
      setPromoLoading(false);
      return;
    }

    setAppliedPromo({
      id: data.id,
      code: data.code,
      discount_type: data.discount_type as 'percentage' | 'fixed',
      discount_value: Number(data.discount_value),
    });
    toast.success('Ο κωδικός εφαρμόστηκε! 🎉');
    setPromoLoading(false);
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setPromoCode('');
  };

  const handlePlaceOrder = async () => {
    if (!user) {
      toast.error('Παρακαλώ συνδεθείτε για να κάνετε παραγγελία');
      navigate('/auth');
      return;
    }
    if (!address.trim()) {
      toast.error('Παρακαλώ εισάγετε διεύθυνση παράδοσης');
      return;
    }
    if (!storeId || items.length === 0) return;

    setSubmitting(true);
    try {
      // Compute driving distance via Mapbox if we have both store + delivery coords
      let distanceKm: number | null = null;
      try {
        const { data: storeData } = await supabase
          .from('stores')
          .select('latitude, longitude')
          .eq('id', storeId)
          .maybeSingle();
        if (
          storeData?.latitude && storeData?.longitude &&
          deliveryCoords?.lat && deliveryCoords?.lon
        ) {
          // Same-address guard: block when within ~30m of the store
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dLat = toRad(deliveryCoords.lat - storeData.latitude);
          const dLon = toRad(deliveryCoords.lon - storeData.longitude);
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(storeData.latitude)) * Math.cos(toRad(deliveryCoords.lat)) * Math.sin(dLon / 2) ** 2;
          const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (meters < 30) {
            toast.error('Η διεύθυνση παράδοσης ταυτίζεται με το κατάστημα. Διάλεξε διαφορετική.');
            setSubmitting(false);
            return;
          }
          const { data: tokenRes } = await supabase.functions.invoke('get-mapbox-token');
          const token = tokenRes?.token;
          if (token) {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${storeData.longitude},${storeData.latitude};${deliveryCoords.lon},${deliveryCoords.lat}?access_token=${token}&overview=false`;
            const res = await fetch(url);
            const json = await res.json();
            const meters = json?.routes?.[0]?.distance;
            if (typeof meters === 'number') distanceKm = +(meters / 1000).toFixed(2);
          }
        }
      } catch {
        // non-fatal: continue without distance
      }

      // Server-side place_order: recomputes totals from authoritative menu prices.
      const { data: orderId, error: orderError } = await (supabase as any).rpc('place_order', {
        p_store_id: storeId,
        p_items: items.map(i => ({ menu_item_id: i.menuItemId, quantity: i.quantity })),
        p_delivery_address: address,
        p_delivery_latitude: deliveryCoords?.lat ?? null,
        p_delivery_longitude: deliveryCoords?.lon ?? null,
        p_payment_method: paymentMethod,
        p_tip_amount: tipAmount,
        p_delivery_fee: deliveryFee,
        p_notes: notes || null,
        p_scheduled_for: scheduledFor,
        p_distance_km: distanceKm,
        p_promo_code: appliedPromo?.code ?? null,
      });

      if (orderError || !orderId) {
        throw orderError || new Error('Αποτυχία δημιουργίας παραγγελίας');
      }
      const order = { id: orderId as string };


      if (paymentMethod === 'card') {
        // Show embedded Stripe checkout — customer pays, webhook completes the order.
        // Clear cart now: the order row exists; if they abandon, admin cleans up.
        clearCart();
        setPendingOrderId(order.id);
      } else {
        clearCart();
        toast.success('Η παραγγελία καταχωρήθηκε! 🎉');
        navigate(`/order-tracking/${order.id}`);
      }
    } catch (error: any) {
      toast.error(error.message || 'Αποτυχία υποβολής παραγγελίας');
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <SEO
          title="Καλάθι αγορών — Fresh Delivery"
          description="Δείτε τα προϊόντα στο καλάθι σας και ολοκληρώστε την παραγγελία φαγητού στο Fresh Delivery."
          path="/checkout"
          noindex
        />
        <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
          <button onClick={() => navigate('/order')} aria-label="Επιστροφή στα εστιατόρια" className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="font-heading font-bold text-lg text-foreground">Το Καλάθι σας</h1>
        </header>
        <div className="text-center py-16 px-4">
          <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <p className="font-heading text-xl text-foreground">Το καλάθι σας είναι άδειο</p>
          <p className="text-sm text-muted-foreground mt-1">Περιηγηθείτε σε εστιατόρια και προσθέστε προϊόντα</p>
          <Button onClick={() => navigate('/order')} className="mt-6 gradient-primary text-primary-foreground font-heading shadow-primary">
            Περιήγηση Εστιατορίων
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <SEO
        title="Ολοκλήρωση παραγγελίας — Fresh Delivery"
        description="Ολοκληρώστε την παραγγελία σας με ασφαλή πληρωμή και γρήγορη παράδοση στην πόρτα σας."
        path="/checkout"
        noindex
      />
      <PaymentTestModeBanner />
      <header className="bg-card/85 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
        <button onClick={() => navigate(-1)} aria-label="Επιστροφή στην προηγούμενη οθόνη" className="h-10 w-10 rounded-full bg-muted flex items-center justify-center active:scale-95 transition-transform">
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] font-extrabold text-muted-foreground leading-none">Checkout</p>
          <h1 className="font-heading font-extrabold text-[17px] text-foreground leading-tight truncate">{storeName}</h1>
        </div>
        <div className="ml-auto bg-primary/10 text-primary rounded-full px-3 py-1.5 text-xs font-extrabold tabular-nums">
          {grandTotal.toFixed(2)}€
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Cart Items */}
        <Card className="rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)]">
          <CardContent className="p-4 space-y-3">
            <h2 className="font-heading font-semibold text-foreground">Τα Προϊόντα σας</h2>
            {items.map(item => (
              <div key={item.menuItemId} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="font-heading text-sm text-foreground truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.price.toFixed(2)}€ το τεμάχιο</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => updateQuantity(item.menuItemId, item.quantity - 1)}
                    className="h-8 w-8 rounded-full bg-muted flex items-center justify-center"
                    aria-label="Μείωση"
                  >
                    {item.quantity === 1 ? <Trash2 className="h-3.5 w-3.5 text-destructive" /> : <Minus className="h-3.5 w-3.5 text-foreground" />}
                  </button>
                  <span className="font-heading font-bold text-sm w-5 text-center text-foreground tabular-nums">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.menuItemId, item.quantity + 1)}
                    className="h-8 w-8 rounded-full gradient-primary flex items-center justify-center"
                    aria-label="Αύξηση"
                  >
                    <Plus className="h-3.5 w-3.5 text-primary-foreground" />
                  </button>
                  <span className="font-heading font-semibold text-sm text-foreground w-14 text-right tabular-nums">
                    {(item.price * item.quantity).toFixed(2)}€
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Delivery Address */}
        <Card className="rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <h2 className="font-heading font-semibold text-foreground">Διεύθυνση Παράδοσης</h2>
            </div>
            <AddressAutocomplete
              value={address}
              onChange={(addr, lat, lon) => {
                setAddress(addr);
                if (lat && lon) setDeliveryCoords({ lat, lon });
              }}
            />
            <SavedAddresses
              currentAddress={address}
              onSelect={(addr, lat, lon) => {
                setAddress(addr);
                setDeliveryCoords(lat && lon ? { lat, lon } : null);
              }}
            />
          </CardContent>
        </Card>

        <ScheduledDeliveryPicker value={scheduledFor} onChange={setScheduledFor} />


        <Card className="rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)]">
          <CardContent className="p-4 space-y-2">
            <Label className="font-heading">Σημειώσεις Παραγγελίας (προαιρετικά)</Label>
            <Textarea
              placeholder="Ειδικές οδηγίες..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </CardContent>
        </Card>

        {/* Tip Selection */}
        <Card className="rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">💰</span>
              <h2 className="font-heading font-semibold text-foreground">Φιλοδώρημα οδηγού</h2>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[10, 15, 20, 'custom' as const].map(opt => {
                const isSelected = tipOption === opt;
                return (
                  <button
                    key={String(opt)}
                    onClick={() => setTipOption(opt)}
                    className={`py-2.5 rounded-xl text-sm font-heading font-semibold transition-all ${
                      isSelected
                        ? 'gradient-primary text-primary-foreground shadow-primary'
                        : 'bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {opt === 'custom' ? 'Άλλο' : `${opt}%`}
                  </button>
                );
              })}
            </div>
            {tipOption !== 'custom' && tipAmount > 0 && (
              <p className="text-sm text-muted-foreground text-center">
                {tipAmount.toFixed(2)}€ φιλοδώρημα
              </p>
            )}
            {tipOption === 'custom' && (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-heading">€</span>
                <Input
                  type="number"
                  value={customTip}
                  onChange={e => setCustomTip(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.50"
                  className="pl-7 font-heading"
                />
              </div>
            )}
            <button
              onClick={() => { setTipOption('custom'); setCustomTip('0'); }}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              Χωρίς φιλοδώρημα
            </button>
          </CardContent>
        </Card>

        {/* Payment method */}
        <Card className="rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)]">
          <CardContent className="p-4 space-y-3">
            <h2 className="font-heading font-semibold text-foreground">Τρόπος πληρωμής</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => cardEnabled && setPaymentMethod('card')}
                disabled={!cardEnabled}
                className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border-2 text-sm font-heading transition-all ${
                  paymentMethod === 'card'
                    ? 'border-primary bg-primary/5 text-foreground shadow-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                } ${!cardEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <CreditCard className="h-5 w-5" />
                <span>Κάρτα</span>
                {!cardEnabled && <span className="text-[10px] italic">Σύντομα διαθέσιμη</span>}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border-2 text-sm font-heading transition-all ${
                  paymentMethod === 'cash'
                    ? 'border-primary bg-primary/5 text-foreground shadow-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                }`}
              >
                <Banknote className="h-5 w-5" />
                <span>Μετρητά</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {paymentMethod === 'card'
                ? 'Πληρώνετε με ασφάλεια online. Ο ΦΠΑ υπολογίζεται αυτόματα.'
                : 'Πληρώνετε στον οδηγό κατά την παράδοση.'}
            </p>
          </CardContent>
        </Card>

        {/* Promo Code */}
        <Card className={`rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)] ${appliedPromo ? 'border-success/30' : ''}`}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              <h2 className="font-heading font-semibold text-foreground">Κωδικός Προσφοράς</h2>
            </div>
            {appliedPromo ? (
              <div className="flex items-center justify-between bg-success/5 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <div>
                    <p className="font-heading font-semibold text-foreground text-sm">{appliedPromo.code}</p>
                    <p className="text-xs text-success">
                      {appliedPromo.discount_type === 'percentage'
                        ? `${appliedPromo.discount_value}% έκπτωση`
                        : `${appliedPromo.discount_value.toFixed(2)}€ έκπτωση`}
                    </p>
                  </div>
                </div>
                <button onClick={removePromo} className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="Εισάγετε κωδικό"
                  value={promoCode}
                  onChange={e => setPromoCode(e.target.value.toUpperCase())}
                  maxLength={30}
                  className="font-mono uppercase"
                  onKeyDown={e => e.key === 'Enter' && handleApplyPromo()}
                />
                <Button
                  onClick={handleApplyPromo}
                  disabled={!promoCode.trim() || promoLoading}
                  variant="outline"
                  className="font-heading shrink-0"
                >
                  {promoLoading ? '...' : 'Εφαρμογή'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order Summary */}
        <Card className="rounded-3xl border-border/60 shadow-[0_4px_18px_-8px_hsl(0_0%_0%/0.10)]">
          <CardContent className="p-4 space-y-2">
            <h2 className="font-heading font-semibold text-foreground">Σύνοψη Παραγγελίας</h2>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Υποσύνολο</span>
              <span className="text-foreground">{total.toFixed(2)}€</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-success">Έκπτωση</span>
                <span className="text-success">-{discount.toFixed(2)}€</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Κόστος Παράδοσης</span>
              <span className="text-foreground">{deliveryFee.toFixed(2)}€</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Φιλοδώρημα Οδηγού</span>
              <span className="text-foreground">{tipAmount.toFixed(2)}€</span>
            </div>
            <div className="mt-2 pt-2 border-t border-dashed border-border space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Καθαρή αξία</span>
                <span className="text-muted-foreground tabular-nums">{netAmount.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">ΦΠΑ {(VAT_RATE * 100).toFixed(0)}% (συμπεριλαμβάνεται)</span>
                <span className="text-muted-foreground tabular-nums">{vatAmount.toFixed(2)}€</span>
              </div>
            </div>
            <div className="flex justify-between font-heading font-bold pt-2 border-t border-border">
              <span className="text-foreground">Σύνολο</span>
              <span className="text-foreground">{grandTotal.toFixed(2)}€</span>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Place Order Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur border-t border-border z-50">
        <div className="max-w-lg mx-auto">
          <Button
            onClick={handlePlaceOrder}
            disabled={submitting || !address.trim()}
            className="w-full h-16 gradient-primary shadow-primary text-primary-foreground font-heading text-base rounded-2xl flex items-center justify-between px-6 active:scale-[0.99] transition-transform"
          >
            <span className="flex items-center gap-2">
              {paymentMethod === 'card' ? <CreditCard className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
              {submitting ? 'Υποβολή…' : paymentMethod === 'card' ? 'Πληρωμή τώρα' : 'Υποβολή Παραγγελίας'}
            </span>
            <span className="font-extrabold text-lg tabular-nums">{grandTotal.toFixed(2)}€</span>
          </Button>
        </div>
      </div>

      {/* Embedded Stripe checkout — opens after card order is created */}
      <Dialog
        open={!!pendingOrderId}
        onOpenChange={(open) => {
          if (!open) {
            // User closed without paying. Order stays as `pending` and is
            // never dispatched; admin can clean up later. Refresh cart so
            // the user can retry.
            setPendingOrderId(null);
            toast.info('Η πληρωμή ακυρώθηκε. Δοκιμάστε ξανά για να ολοκληρώσετε.');
          }
        }}
      >
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-2">
            <DialogTitle className="font-heading">Ασφαλής πληρωμή — {grandTotal.toFixed(2)}€</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 max-h-[80vh] overflow-y-auto">
            {pendingOrderId && (
              <OrderCheckout
                orderId={pendingOrderId}
                returnPath={`/order-tracking/${pendingOrderId}`}
                onError={(msg) => toast.error(msg)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
