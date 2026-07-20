import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Car, Navigation, Zap, Radio, MapPin, Crosshair, ArrowLeft, X, ClipboardList, ShieldCheck, PackageCheck } from 'lucide-react';
import { useDriverLocation } from '@/hooks/useDriverLocation';
import { useDriverNotifications } from '@/hooks/useDriverNotifications';
import { useAuth } from '@/hooks/useAuth';
import { UserMenu } from '@/components/UserMenu';
import { Badge } from '@/components/ui/badge';
import { OrderOfferCard } from '@/components/driver/OrderOfferCard';
import { StackedOfferCard } from '@/components/driver/StackedOfferCard';
import { ActiveDelivery } from '@/components/driver/ActiveDelivery';
import { StackedOrderBanner } from '@/components/driver/StackedOrderBanner';
import { DriverWallet } from '@/components/driver/DriverWallet';
import DriverCashWallet from '@/components/driver/DriverCashWallet';
import { DriverReferral } from '@/components/driver/DriverReferral';
import { DriverSupportButton } from '@/components/driver/DriverSupportButton';
import { EarningsDashboard } from '@/components/driver/EarningsDashboard';

import DriverGoalsCard from '@/components/driver/DriverGoalsCard';

import { useDriverOrders } from '@/hooks/useOrders';
import { useDriverState } from '@/hooks/useDriverState';
import { useEarnings } from '@/hooks/useEarnings';
import AnnouncementsBanner from '@/components/AnnouncementsBanner';
import SurgeStatusBadge from '@/components/driver/SurgeStatusBadge';
import { supabase } from '@/integrations/supabase/client';
import type { RouteInfo, DriverMapboxHandle } from '@/components/driver/DriverMapbox';
// Lazy-load the map: mapbox-gl is large (~800KB) and was blocking the driver app's initial paint.
const DriverMapbox = lazy(() => import('@/components/driver/DriverMapbox'));

import { TurnByTurnBanner } from '@/components/driver/TurnByTurnBanner';
import { NavBottomCard } from '@/components/driver/NavBottomCard';
import { SlideToggle } from '@/components/driver/SlideToggle';

import { useNearbyStoresForDriver } from '@/hooks/useNearbyStoresForDriver';
import { geocodeAddress, warmMapboxToken } from '@/lib/geocode';
import { useDriverAppPrefs } from '@/hooks/useDriverAppPrefs';
import { DriverPrefsApplier } from '@/components/driver/DriverPrefsApplier';


type DriverTab = 'home' | 'earnings' | 'wallet' | 'referral';

export default function DriverApp() {
  const { user, isAdmin: isAdminRole } = useAuth();
  // Admins can toggle between "Admin Driver Ops" and the regular driver experience
  const [adminAsDriver, setAdminAsDriver] = useState<boolean>(() => {
    try { return localStorage.getItem('admin_as_driver') === '1'; } catch { return false; }
  });
  const isAdmin = isAdminRole && !adminAsDriver;
  const toggleAdminView = () => {
    setAdminAsDriver(prev => {
      const next = !prev;
      try { localStorage.setItem('admin_as_driver', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const { offers, stackedOffers, activeDelivery, loading, acceptOrder, declineOrder, updateDeliveryStatus, offerExpiresAt, offerTimeoutSec } = useDriverOrders({ adminOverride: isAdmin });
  const { state: driverState } = useDriverState();
  const onBreak = !!driverState?.on_break;
  const [maxCashCap, setMaxCashCap] = useState<number>(200);
  useEffect(() => { warmMapboxToken(); }, []);

  useEffect(() => {
    (supabase as any).rpc('get_platform_settings_public')
      .then(({ data }: any) => {
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.max_cash_cap != null) setMaxCashCap(Number(row.max_cash_cap));
      });
  }, []);
  const cashCapped = Number(driverState?.shift_cash_balance ?? 0) >= maxCashCap;
  // Drivers stay online persistently — once they go online they remain online
  // across reloads, backgrounding, and tab close. Only an explicit toggle
  // (or admin suspension) takes them offline.
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    try { return localStorage.getItem('driver_is_online_v1') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('driver_is_online_v1', isOnline ? '1' : '0'); } catch {}
  }, [isOnline]);
  const [driverActive, setDriverActive] = useState<boolean | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  
  const tabParam = searchParams.get('tab');
  const activeTab: DriverTab = (tabParam === 'earnings' || tabParam === 'wallet' || tabParam === 'referral') ? tabParam : 'home';
  const setActiveTab = (t: DriverTab) => {
    if (t === 'home') { searchParams.delete('tab'); setSearchParams(searchParams); }
    else { searchParams.set('tab', t); setSearchParams(searchParams); }
  };
  useEarnings();
  useDriverNotifications();

  useEffect(() => {
    if (!user) return;
    supabase.from('driver_profiles').select('is_active').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setDriverActive(data ? data.is_active : true));

    // Realtime: if admin suspends driver, force offline immediately
    const channel = supabase
      .channel(`driver-active-${user.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'driver_profiles', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const active = (payload.new as { is_active?: boolean }).is_active;
          setDriverActive(active ?? true);
          if (active === false) setIsOnline(false);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Force offline whenever driver becomes inactive
  useEffect(() => {
    if (driverActive === false && isOnline) setIsOnline(false);
  }, [driverActive, isOnline]);

  const { tracking, error: locError } = useDriverLocation(isOnline);
  const { stores: nearbyStores } = useNearbyStoresForDriver();
  const driverPrefs = useDriverAppPrefs();
  const [storeInfo, setStoreInfo] = useState<{ name: string; address: string; phone: string | null; latitude: number | null; longitude: number | null } | null>(null);
  const [customerInfo, setCustomerInfo] = useState<{ name: string; phone: string | null } | null>(null);
  const handleDecline = (id: string) => { declineOrder(id); };
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [navMode, setNavMode] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const sheetDragStartY = useRef<number | null>(null);
  const sheetDragMoved = useRef(false);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const mapRef = useRef<DriverMapboxHandle>(null);

  const navigatingTo = activeDelivery
    ? (['accepted', 'preparing', 'ready', 'arrived'].includes(activeDelivery.status ?? '') ? 'store' as const : activeDelivery.status === 'picked_up' ? 'customer' as const : null)
    : null;

  // Auto-exit nav mode if delivery ends
  useEffect(() => { if (!activeDelivery) setNavMode(false); }, [activeDelivery]);
  const isNavActive = navMode && !!navigatingTo;

  // Pick the upcoming maneuver step + live distance to it from the driver's GPS.
  // Mapbox steps include a maneuver location; we find the closest upcoming one
  // and project the remaining distance using the haversine formula.
  const navProgress = (() => {
    if (!routeInfo || !driverPos) return null;
    const steps = routeInfo.steps || [];
    if (!steps.length) return null;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversineM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    let bestIdx = 0;
    let bestDist = Infinity;
    steps.forEach((s, i) => {
      if (!s.location) return;
      const d = haversineM(driverPos, { lat: s.location[1], lng: s.location[0] });
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    // Prefer the *upcoming* step: if we're past the closest one (very near it),
    // surface the next one as the active maneuver.
    let activeIdx = bestIdx;
    if (bestDist < 25 && bestIdx + 1 < steps.length) activeIdx = bestIdx + 1;
    const active = steps[activeIdx];
    let distanceToNext = 0;
    if (active?.location) {
      distanceToNext = haversineM(driverPos, { lat: active.location[1], lng: active.location[0] });
    }
    return { step: active, distanceToNext, nextStreet: steps[activeIdx + 1]?.name ?? active?.name ?? null };
  })();

  // Geocoded fallback for delivery destination if order has no coords
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!activeDelivery) { setStoreInfo(null); setCustomerInfo(null); setDeliveryCoords(null); return; }
    (supabase as any).rpc('get_store_contact', { _store_id: activeDelivery.store_id })
      .then(({ data }: any) => { if (data && data[0]) setStoreInfo(data[0]); });

    if (activeDelivery.customer_id) {
      supabase.from('profiles').select('full_name, phone').eq('user_id', activeDelivery.customer_id).single()
        .then(({ data }) => { if (data) setCustomerInfo({ name: data.full_name || 'Πελάτης', phone: data.phone }); });
    }

    // If order is missing delivery coords, geocode the address so the route can be drawn
    const hasCoords = activeDelivery.delivery_latitude != null && activeDelivery.delivery_longitude != null;
    if (!hasCoords && activeDelivery.delivery_address) {
      let cancelled = false;
      geocodeAddress(activeDelivery.delivery_address).then((res) => {
        if (!cancelled && res) setDeliveryCoords({ lat: res.latitude, lng: res.longitude });
      });
      return () => { cancelled = true; };
    } else {
      setDeliveryCoords(null);
    }
  }, [activeDelivery?.id, activeDelivery?.store_id, activeDelivery?.customer_id, activeDelivery?.delivery_address, activeDelivery?.delivery_latitude, activeDelivery?.delivery_longitude]);

  // Pending approval
  if (driverActive === false) {
    return (
      <div className="min-h-screen driver-shell bg-[hsl(var(--driver-bg))] flex items-center justify-center p-6">
        <div className="text-center max-w-sm space-y-4">
          <div className="h-20 w-20 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto border border-destructive/20">
            <Car className="h-10 w-10 text-destructive" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-[hsl(var(--driver-text))]">Αναμονή Έγκρισης</h1>
          <p className="text-[hsl(var(--driver-text-muted))] text-sm">Ο λογαριασμός σας βρίσκεται σε αναμονή έγκρισης.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2.5 rounded-xl text-sm font-heading font-semibold border border-[hsl(var(--driver-border))] text-[hsl(var(--driver-text))] hover:bg-[hsl(var(--driver-surface))] transition-colors">
            Έλεγχος Κατάστασης
          </button>
        </div>
      </div>
    );
  }

  if (driverActive === null && !loading) {
    return (
      <div className="min-h-screen driver-shell bg-[hsl(var(--driver-bg))] flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  void MapPin; // unused but kept for future

  if (isAdmin) {
    return (
      <div className="min-h-[100dvh] driver-shell bg-background text-foreground overflow-y-auto">
        <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 safe-area-top">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-heading font-bold uppercase tracking-wider text-muted-foreground">Admin Driver Ops</p>
                <h1 className="font-heading text-lg font-extrabold truncate">Έτοιμες Παραγγελίες</h1>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <Badge className="bg-primary text-primary-foreground font-heading">{offers.length}</Badge>
              {isAdminRole && (
                <button
                  onClick={toggleAdminView}
                  className="h-8 px-2.5 rounded-lg text-[11px] font-heading font-bold border border-border bg-card hover:bg-muted transition-colors flex items-center gap-1.5"
                  title="Εναλλαγή σε προβολή κανονικού οδηγού"
                >
                  <Car className="h-3.5 w-3.5" />
                  Driver view
                </button>
              )}
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="px-4 py-4 space-y-4 max-w-3xl mx-auto">
          {activeDelivery && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <PackageCheck className="h-4 w-4 text-primary" />
                <h2 className="font-heading font-bold text-sm">Παραγγελία που ανέλαβες</h2>
              </div>
              <ActiveDelivery
                delivery={{
                  id: activeDelivery.id,
                  storeName: storeInfo?.name || activeDelivery.store_name || 'Σημείο Παραλαβής',
                  storeAddress: storeInfo?.address || activeDelivery.store_address || 'Διεύθυνση',
                  storePhone: storeInfo?.phone || null,
                  storeLat: storeInfo?.latitude ?? null,
                  storeLng: storeInfo?.longitude ?? null,
                  deliveryAddress: activeDelivery.delivery_address || 'Πελάτης',
                  deliveryLat: activeDelivery.delivery_latitude ?? deliveryCoords?.lat ?? null,
                  deliveryLng: activeDelivery.delivery_longitude ?? deliveryCoords?.lng ?? null,
                  customerName: customerInfo?.name || 'Πελάτης',
                  customerPhone: customerInfo?.phone || null,
                  status: activeDelivery.status ?? 'accepted',
                  items: activeDelivery.order_items?.map(i => ({ name: i.name, quantity: i.quantity })) ?? [],
                  estimatedPayout: (Number(activeDelivery.delivery_fee ?? 0) + Number(activeDelivery.tip_amount ?? 0)) || Number((activeDelivery as any).driver_payout ?? 0) || Math.max(2, Number(activeDelivery.distance_km ?? 0) * 0.5 + 2),
                  pickupChecklist: ['Όλα τα προϊόντα', 'Ποτά', 'Μαχαιροπίρουνα'],
                  predictedReadyAt: (activeDelivery as any).predicted_ready_at ?? null,
                  notes: (activeDelivery as any).notes ?? null,
                  paymentMethod: (activeDelivery as any).payment_method ?? null,
                  cashToCollect: (activeDelivery as any).payment_method === 'cash'
                    ? Number((activeDelivery as any).cash_received ?? 0) || (Number((activeDelivery as any).total_amount ?? 0) + Number((activeDelivery as any).delivery_fee ?? 0) + Number((activeDelivery as any).tip_amount ?? 0))
                    : null,
                }}
                driverId={user?.id}
                onStatusUpdate={(status) => updateDeliveryStatus(activeDelivery.id, status)}
                
              />
            </section>
          )}

          <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ClipboardList className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <h2 className="font-heading font-bold text-sm truncate">Λίστα διαθέσιμων για ανάληψη</h2>
                  <p className="text-xs text-muted-foreground">Προσφορές dispatch και έτοιμες παραγγελίες</p>
                </div>
              </div>
              {loading && <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />}
            </div>

            {!loading && offers.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="font-heading font-bold text-sm">Δεν υπάρχουν έτοιμες παραγγελίες</p>
                <p className="text-xs text-muted-foreground mt-1">Μόλις γίνει dispatch σε οδηγό, η παραγγελία θα εμφανιστεί εδώ.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {offers.map((offer) => {
                  const isClaimed = !!offer.driver_id;
                  const isReady = offer.status === 'ready';
                  return (
                  <article key={offer.id} className="p-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-heading text-[10px] uppercase">{offer.source}</Badge>
                        <span className="text-xs font-heading font-bold text-primary">#{offer.id.slice(0, 8)}</span>
                        {isClaimed && (
                          <Badge variant="destructive" className="font-heading text-[10px] uppercase">
                            Σε οδηγό
                          </Badge>
                        )}
                        {!isReady && (
                          <Badge variant="secondary" className="font-heading text-[10px] uppercase">
                            Προετοιμασία
                          </Badge>
                        )}
                      </div>
                      <div>
                        <p className="font-heading font-bold text-base truncate">{offer.store_name || 'Κατάστημα'}</p>
                        <p className="text-xs text-muted-foreground truncate">Παραλαβή: {offer.store_address || 'Διεύθυνση καταστήματος'}</p>
                        <p className="text-xs text-muted-foreground truncate">Παράδοση: {offer.delivery_address || 'Πελάτης'}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <span className="rounded-lg bg-muted px-2 py-1">{offer.order_items?.length ?? 0} τεμ.</span>
                        <span className="rounded-lg bg-muted px-2 py-1">€{Number(offer.delivery_fee ?? offer.driver_payout ?? 0).toFixed(2)} οδηγός</span>
                        {offer.distance_km != null && <span className="rounded-lg bg-muted px-2 py-1">{Number(offer.distance_km).toFixed(1)} χλμ</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => acceptOrder(offer.id)}
                      className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-heading font-bold shadow-primary hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100"
                      disabled={!isReady}
                    >
                      {isReady ? (isClaimed ? 'Ανάκτηση' : 'Ανάληψη') : 'Αναμονή'}
                    </button>
                  </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }


  return (
    <div className="h-[100dvh] w-screen max-w-full flex flex-col driver-shell bg-[hsl(var(--driver-bg))] overflow-hidden overscroll-none">
      <DriverPrefsApplier
        isOnline={isOnline}
        onForceOffline={() => setIsOnline(false)}
        hasActiveDelivery={!!activeDelivery}
      />
      {activeTab === 'home' ? (
        <div className="flex-1 relative">
          <Suspense fallback={<div className="fixed inset-0 z-0 bg-muted/40" />}>
            <DriverMapbox
              ref={mapRef}
              className="fixed inset-0 z-0"
              storeLat={storeInfo?.latitude}
              storeLng={storeInfo?.longitude}
              storeName={storeInfo?.name}
              customerLat={activeDelivery?.delivery_latitude ?? deliveryCoords?.lat ?? null}
              customerLng={activeDelivery?.delivery_longitude ?? deliveryCoords?.lng ?? null}
              customerName={customerInfo?.name}
              customerAddress={activeDelivery?.delivery_address}
              navigatingTo={navigatingTo}
              onRouteUpdate={setRouteInfo}
              onDriverPosUpdate={setDriverPos}
              nearbyStores={activeDelivery || !driverPrefs.showStorePinsOnMap ? [] : nearbyStores}
              followMode={isNavActive}
            />
          </Suspense>


          {!isNavActive && (
            <div className="fixed top-0 left-0 right-0 z-20 safe-area-top animate-slide-down pointer-events-none">
              <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
                <div className="shrink-0 pointer-events-auto flex items-center gap-1.5">
                  <UserMenu />
                  {isAdminRole && adminAsDriver && (
                    <button
                      onClick={toggleAdminView}
                      className="h-9 px-2.5 rounded-full text-[10.5px] font-heading font-bold border border-border bg-card/95 backdrop-blur-md shadow-lg hover:bg-card transition-colors flex items-center gap-1 text-foreground"
                      title="Επιστροφή σε Admin Driver Ops"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      Ops
                    </button>
                  )}
                </div>
                <div className="bg-[hsl(var(--driver-surface))]/95 backdrop-blur-xl rounded-full pl-1 pr-3.5 py-1 flex items-center gap-2 min-w-0 shadow-[0_4px_16px_-4px_hsl(220,18%,14%,0.12)] border border-[hsl(var(--driver-border))]">
                  <div className="h-7 w-7 rounded-full driver-gradient-earn flex items-center justify-center shrink-0">
                    <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
                  </div>
                  <span className="font-heading font-extrabold text-[hsl(var(--driver-text))] text-[12.5px] tracking-tight truncate">Fresh Delivery</span>
                </div>
                <div className="shrink-0 pointer-events-auto flex items-center gap-2">
                  <DriverSupportButton orderId={activeDelivery?.id} />
                </div>
              </div>
            </div>
          )}

          {/* In-app turn-by-turn: dark instruction banner pinned to the top */}
          {isNavActive && (
            <div className="fixed top-0 left-0 right-0 z-30 safe-area-top px-3 pt-3 animate-slide-down pointer-events-none">
              <div className="pointer-events-auto">
                {navProgress && navProgress.step ? (
                  <TurnByTurnBanner
                    distanceToNext={navProgress.distanceToNext}
                    step={navProgress.step}
                    nextStreet={navProgress.nextStreet}
                  />
                ) : (
                  <div className="rounded-2xl bg-[hsl(0,0%,12%)] text-white px-4 py-3 flex items-center gap-3 shadow-2xl">
                    <div className="h-5 w-5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-heading">Υπολογισμός διαδρομής…</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Floating action stack — right side, in-app turn-by-turn (support / re-route / recenter) */}
          {isNavActive && (
            <div className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3 pointer-events-auto animate-pop">
              <DriverSupportButton orderId={activeDelivery?.id} />
              <button
                onClick={() => mapRef.current?.focusOn(navigatingTo!)}
                className="h-12 w-12 rounded-full bg-card border border-border flex items-center justify-center shadow-lg hover:bg-accent active:scale-90 transition-all"
                aria-label="Προβολή ολόκληρης διαδρομής"
                title="Προβολή ολόκληρης διαδρομής"
              >
                <Navigation className="h-5 w-5 text-foreground" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => mapRef.current?.recenter()}
                className="h-12 w-12 rounded-full bg-card border border-border flex items-center justify-center shadow-lg hover:bg-accent active:scale-90 transition-all"
                aria-label="Επανακέντρωμα στη θέση μου"
                title="Επανακέντρωμα στη θέση μου"
              >
                <Crosshair className="h-5 w-5 text-primary" strokeWidth={2.5} />
              </button>
            </div>
          )}

          {/* Bottom sheet for in-app turn-by-turn — outside the scrollable column so it's always pinned */}
          {isNavActive && (
            <div className="fixed bottom-0 left-0 right-0 z-30 pointer-events-auto animate-slide-up safe-area-bottom">
              <NavBottomCard
                title={navigatingTo === 'store'
                  ? (storeInfo?.name || 'Κατάστημα')
                  : (customerInfo?.name || 'Πελάτης')}
                subtitle={navigatingTo === 'store'
                  ? (storeInfo?.address ?? null)
                  : (activeDelivery?.delivery_address ?? null)}
                durationSec={routeInfo?.duration ?? 0}
                distanceMeters={routeInfo?.distance ?? 0}
                phone={navigatingTo === 'store'
                  ? (storeInfo?.phone ?? null)
                  : (customerInfo?.phone ?? null)}
                onExit={() => setNavMode(false)}
              />
            </div>
          )}


          <div className={`fixed bottom-0 left-0 right-0 z-20 ${sheetCollapsed ? 'max-h-[18vh]' : 'max-h-[72vh]'} overflow-y-auto px-3 pb-3 safe-area-bottom pointer-events-none scrollbar-thin overscroll-contain transition-[max-height] duration-300 ease-out ${isNavActive ? 'hidden' : ''}`}>
            {/* Recenter button — pinned just above the sheet */}
            <div className="flex justify-end pb-2 pointer-events-auto">
              <button
                onClick={() => mapRef.current?.recenter()}
                className="h-10 w-10 rounded-full driver-glass border border-[hsl(var(--driver-border))] flex items-center justify-center shadow-lg hover:bg-[hsl(var(--driver-surface))] transition-all duration-200 active:scale-90"
                aria-label="Επανακέντρωμα"
              >
                <Crosshair className="h-5 w-5 text-[hsl(var(--driver-text))]" />
              </button>
            </div>
            {/* Drag handle — tap to toggle, or swipe up/down to expand/collapse */}
            <div
              className="pointer-events-auto w-full flex items-center justify-center pt-2 pb-3 -mb-1 group cursor-grab active:cursor-grabbing touch-none select-none"
              role="button"
              tabIndex={0}
              aria-label={sheetCollapsed ? 'Άνοιγμα πίνακα' : 'Σύμπτυξη πίνακα'}
              title={sheetCollapsed ? 'Άνοιγμα — σύρε πάνω' : 'Σύμπτυξη — σύρε κάτω'}
              onClick={() => { if (!sheetDragMoved.current) setSheetCollapsed(v => !v); }}
              onTouchStart={(e) => { sheetDragStartY.current = e.touches[0].clientY; sheetDragMoved.current = false; }}
              onTouchMove={(e) => {
                if (sheetDragStartY.current == null) return;
                const dy = e.touches[0].clientY - sheetDragStartY.current;
                if (Math.abs(dy) > 8) sheetDragMoved.current = true;
                if (dy < -24 && sheetCollapsed) { setSheetCollapsed(false); sheetDragStartY.current = null; }
                else if (dy > 24 && !sheetCollapsed) { setSheetCollapsed(true); sheetDragStartY.current = null; }
              }}
              onTouchEnd={() => { sheetDragStartY.current = null; }}
              onPointerDown={(e) => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); sheetDragStartY.current = e.clientY; sheetDragMoved.current = false; }}
              onPointerMove={(e) => {
                if (sheetDragStartY.current == null) return;
                const dy = e.clientY - sheetDragStartY.current;
                if (Math.abs(dy) > 8) sheetDragMoved.current = true;
                if (dy < -24 && sheetCollapsed) { setSheetCollapsed(false); sheetDragStartY.current = null; }
                else if (dy > 24 && !sheetCollapsed) { setSheetCollapsed(true); sheetDragStartY.current = null; }
              }}
              onPointerUp={() => { sheetDragStartY.current = null; }}
              onPointerCancel={() => { sheetDragStartY.current = null; }}
            >
              <span className="h-1.5 w-14 rounded-full bg-[hsl(var(--driver-text-muted))]/50 group-active:bg-[hsl(var(--driver-text-muted))]/80 transition-colors" />
            </div>
            <div className="pointer-events-auto space-y-2.5 animate-slide-up">

              {/* (In nav mode the dark banner + bottom card are rendered as fixed overlays above) */}

              {!isNavActive && (
                <>
                  <AnnouncementsBanner audience="drivers" />
                  <SurgeStatusBadge />

                  {/* On-break banner */}
                  {onBreak && (
                    <div className="px-3 py-2.5 rounded-xl bg-warning/15 border border-warning/30 driver-glass flex items-center gap-2">
                      <span className="text-xs font-heading font-semibold text-warning">⏸ Σε διάλειμμα — δεν λαμβάνετε νέες παραγγελίες</span>
                    </div>
                  )}

                  {/* Active delivery card */}
                  {activeDelivery && (
                    <>
                      <StackedOrderBanner orderId={activeDelivery.id} />

                      {/* Stacked offers — same store, on the path */}
                      {stackedOffers.length > 0 && (
                        <div className="space-y-2.5 animate-slide-up">
                          {stackedOffers.map((offer, idx) => (
                            <StackedOfferCard
                              key={offer.id}
                              index={idx + 2}
                              offer={{
                                id: offer.id,
                                storeName: offer.store_name || storeInfo?.name || 'Ίδιο κατάστημα',
                                storeAddress: offer.store_address || storeInfo?.address || 'Παραλαβή',
                                deliveryAddress: offer.delivery_address || 'Πελάτης',
                                estimatedPayout: (Number(offer.delivery_fee ?? 0) + Number(offer.tip_amount ?? 0) + Number((offer as any).driver_pool_bonus ?? 0)) || Number((offer as any).driver_payout ?? 0) || Math.max(2, Number(offer.distance_km ?? 0) * 0.5 + 2),
                                basePay: Number(offer.delivery_fee ?? 0) || Number((offer as any).driver_payout ?? 0) || Math.max(2, Number(offer.distance_km ?? 0) * 0.5 + 2),
                                tipAmount: Number(offer.tip_amount ?? 0),
                                poolBonus: Number((offer as any).driver_pool_bonus ?? 0),
                                paymentMethod: (offer as any).payment_method ?? null,
                                cashToCollect: (offer as any).payment_method === 'cash'
                                  ? Number((offer as any).cash_received ?? 0) || (Number((offer as any).total_amount ?? 0) + Number((offer as any).delivery_fee ?? 0) + Number((offer as any).tip_amount ?? 0))
                                  : null,
                                totalDistance: Number(offer.distance_km ?? 0),
                                estimatedTime: offer.estimated_prep_time ?? 20,
                                itemCount: offer.order_items?.length ?? 0,
                              }}
                              onAccept={acceptOrder}
                              onDecline={handleDecline}
                              onRemove={handleDecline}
                              expiresAt={offerExpiresAt[offer.id] ?? null}
                              timeoutSec={offerTimeoutSec}
                            />
                          ))}
                        </div>
                      )}
                      {locError && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 driver-glass">
                          <Navigation className="h-3.5 w-3.5 text-destructive" />
                          <span className="text-xs font-heading text-destructive">GPS: {locError}</span>
                        </div>
                      )}
                      <ActiveDelivery
                        delivery={{
                          id: activeDelivery.id,
                          storeName: storeInfo?.name || 'Σημείο Παραλαβής',
                          storeAddress: storeInfo?.address || 'Διεύθυνση',
                          storePhone: storeInfo?.phone || null,
                          storeLat: storeInfo?.latitude ?? null,
                          storeLng: storeInfo?.longitude ?? null,
                          deliveryAddress: activeDelivery.delivery_address || 'Πελάτης',
                          deliveryLat: activeDelivery.delivery_latitude ?? deliveryCoords?.lat ?? null,
                          deliveryLng: activeDelivery.delivery_longitude ?? deliveryCoords?.lng ?? null,
                          customerName: customerInfo?.name || 'Πελάτης',
                          customerPhone: customerInfo?.phone || null,
                          status: activeDelivery.status ?? 'accepted',
                          items: activeDelivery.order_items?.map(i => ({ name: i.name, quantity: i.quantity })) ?? [],
                          estimatedPayout: (Number(activeDelivery.delivery_fee ?? 0) + Number(activeDelivery.tip_amount ?? 0)) || Number((activeDelivery as any).driver_payout ?? 0) || Math.max(2, Number(activeDelivery.distance_km ?? 0) * 0.5 + 2),
                          pickupChecklist: ['Όλα τα προϊόντα', 'Ποτά', 'Μαχαιροπίρουνα'],
                          predictedReadyAt: (activeDelivery as any).predicted_ready_at ?? null,
                          notes: (activeDelivery as any).notes ?? null,
                          paymentMethod: (activeDelivery as any).payment_method ?? null,
                          cashToCollect: (activeDelivery as any).payment_method === 'cash'
                            ? Number((activeDelivery as any).cash_received ?? 0) || (Number((activeDelivery as any).total_amount ?? 0) + Number((activeDelivery as any).delivery_fee ?? 0) + Number((activeDelivery as any).tip_amount ?? 0))
                            : null,
                        }}
                        driverId={user?.id}
                        onStatusUpdate={(status) => updateDeliveryStatus(activeDelivery.id, status)}
                        onFocusDestination={() => { setNavMode(true); }}
                      />
                    </>
                  )}

              {/* Cash cap banner — blocks new offers */}
              {!activeDelivery && isOnline && !onBreak && cashCapped && (
                <div className="rounded-2xl border-2 border-destructive bg-destructive/10 p-4 animate-pop">
                  <p className="font-heading font-bold text-sm text-destructive mb-1">🚫 Όριο μετρητών συμπληρώθηκε</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    Έχεις €{Number(driverState?.shift_cash_balance ?? 0).toFixed(2)} σε μετρητά (όριο €{maxCashCap}).
                    Παρέδωσε τα χρήματα στον διαχειριστή για να ξεκινήσουν νέες παραγγελίες.
                  </p>
                </div>
              )}

              {/* Order offer cards */}
              {!activeDelivery && isOnline && !onBreak && !cashCapped && !loading && offers.length > 0 && (
                <div className="space-y-3 animate-slide-up">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">
                        {isAdmin ? 'Όλες οι Διαθέσιμες' : 'Νέες Παραγγελίες'}
                      </h3>
                      {isAdmin && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 rounded px-1.5 py-0.5">
                          Ops
                        </span>
                      )}
                    </div>
                    <Badge className="bg-primary text-primary-foreground font-heading text-[10px] px-2 py-0.5 animate-pop">{offers.length}</Badge>
                  </div>
                  {offers.map((offer, i) => (
                    <div key={offer.id} className="animate-pop" style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'both' }}>
                      <OrderOfferCard
                        offer={{
                          id: offer.id,
                          storeName: offer.store_name || 'Κατάστημα',
                          storeAddress: offer.store_address || 'Διεύθυνση καταστήματος',
                          deliveryAddress: offer.delivery_address || 'Πελάτης',
                          estimatedPayout: (Number(offer.delivery_fee ?? 0) + Number(offer.tip_amount ?? 0) + Number((offer as any).driver_pool_bonus ?? 0)) || Number((offer as any).driver_payout ?? 0) || Math.max(2, Number(offer.distance_km ?? 0) * 0.5 + 2),
                          basePay: Number(offer.delivery_fee ?? 0) || Number((offer as any).driver_payout ?? 0) || Math.max(2, Number(offer.distance_km ?? 0) * 0.5 + 2),
                          tipAmount: Number(offer.tip_amount ?? 0),
                          poolBonus: Number((offer as any).driver_pool_bonus ?? 0),
                          paymentMethod: (offer as any).payment_method ?? null,
                          cashToCollect: (offer as any).payment_method === 'cash'
                            ? Number((offer as any).cash_received ?? 0) || (Number((offer as any).total_amount ?? 0) + Number((offer as any).delivery_fee ?? 0) + Number((offer as any).tip_amount ?? 0))
                            : null,
                          customerNotes: (offer as any).notes ?? null,
                          perKmRate: 0.50,
                          totalDistance: Number((offer as any).distance_km ?? 0),
                          estimatedTime: offer.estimated_prep_time ?? 20,
                          itemCount: offer.order_items?.length ?? 0,
                        }}
                        onAccept={acceptOrder}
                        onDecline={handleDecline}
                        expiresAt={offerExpiresAt[offer.id] ?? null}
                        timeoutSec={offerTimeoutSec}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Combined Online/Offline + Waiting state */}
              {!activeDelivery && (
                <div className="driver-glass rounded-2xl overflow-hidden transition-all duration-500 ease-out animate-scale-in">
                  {/* Waiting for orders (online, no offers) */}
                  {isOnline && !loading && offers.length === 0 && (
                    <div className="p-5 text-center animate-fade-in">
                      <div className="relative h-12 w-12 mx-auto mb-3">
                        <div className="absolute inset-0 rounded-xl bg-primary/15 animate-ping opacity-30" />
                        <div className="relative h-12 w-12 rounded-xl bg-[hsl(var(--driver-surface))] flex items-center justify-center border border-primary/20">
                          <Zap className="h-6 w-6 text-primary" />
                        </div>
                      </div>
                      <p className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">Αναμονή Παραγγελιών</p>
                      <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[hsl(var(--driver-accent))]/10 border border-[hsl(var(--driver-accent))]/15">
                        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--driver-accent))] animate-pulse" />
                        <span className="text-[10px] font-heading font-medium text-[hsl(var(--driver-accent))]">Ζωντανή Αναζήτηση</span>
                      </div>
                    </div>
                  )}

                  {/* Loading */}
                  {isOnline && loading && (
                    <div className="p-5 text-center animate-fade-in">
                      <div className="h-8 w-8 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-[hsl(var(--driver-text-muted))] font-heading text-xs">Αναζήτηση...</p>
                    </div>
                  )}

                  {/* Offline message */}
                  {!isOnline && (
                    <div className="p-5 text-center animate-fade-in">
                      <Radio className="h-7 w-7 text-[hsl(var(--driver-text-muted))] mx-auto mb-2" />
                      <p className="font-heading font-bold text-[hsl(var(--driver-text))] text-sm">Εκτός Σύνδεσης</p>
                      <p className="text-xs text-[hsl(var(--driver-text-muted))] mt-1">Σύρετε για να συνδεθείτε</p>
                    </div>
                  )}

                  {/* Slide to go Online/Offline */}
                  <div className="px-4 pb-4 pt-1">
                    <SlideToggle
                      isOn={isOnline}
                      onToggle={setIsOnline}
                      onLabel="Είσαι Online"
                      offLabel="Σύρε για να συνδεθείς"
                      disabled={driverActive !== true}
                    />
                  </div>
                </div>
              )}
                </>
              )}

            </div>
          </div>
        </div>
      ) : (
        /* ─── NON-MAP TABS ─── */
        <>
          <header className="relative z-30 px-4 py-3 flex items-center justify-between bg-[hsl(var(--driver-surface))]/95 backdrop-blur-xl border-b border-[hsl(var(--driver-border))] safe-area-top animate-slide-down">
            <button
              onClick={() => setActiveTab('home')}
              className="h-10 w-10 rounded-full bg-[hsl(var(--driver-surface))] border border-[hsl(var(--driver-border))] shadow-sm flex items-center justify-center hover:bg-[hsl(var(--driver-surface-muted))] transition-all duration-200 active:scale-90"
              aria-label="Πίσω"
            >
              <ArrowLeft className="h-5 w-5 text-[hsl(var(--driver-text))]" />
            </button>
            <div className="flex items-center gap-2 animate-fade-in">
              <div className="h-7 w-7 rounded-full driver-gradient-earn flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-heading font-extrabold text-[hsl(var(--driver-text))] text-[15px] tracking-tight">
                Fresh Delivery
                {isAdmin && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/30">
                    Ops
                  </span>
                )}
              </span>
            </div>
            <div className="w-10" />
          </header>
          <div key={activeTab} className="flex-1 overflow-y-auto pb-6 animate-fade-in">
            {activeTab === 'earnings' && (
              <div className="px-4 py-4 space-y-4">
                <DriverWallet />
                <DriverGoalsCard />
                <EarningsDashboard />
              </div>
            )}
            {activeTab === 'wallet' && (
              <div className="px-4 py-4"><DriverCashWallet /></div>
            )}
            {activeTab === 'referral' && (
              <div className="px-4 py-4"><DriverReferral /></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
