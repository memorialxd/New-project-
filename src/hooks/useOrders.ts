import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { playOrderSound, showOrderNotification } from '@/lib/notifications';
import { playOfferAlert } from '@/lib/driver-sound-prefs';

import type { Database } from '@/integrations/supabase/types';

type OrderRow = Database['public']['Tables']['orders']['Row'];
type OrderItemRow = Database['public']['Tables']['order_items']['Row'];

export interface OrderWithItems extends OrderRow {
  order_items: OrderItemRow[];
  store_name?: string;
  store_address?: string | null;
}

export function useStoreOrders(storeId: string | null) {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    if (!storeId) return;
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('store_id', storeId)
      .in('status', ['placed', 'accepted', 'preparing', 'ready'])
      .order('created_at', { ascending: false });

    if (!error && data) {
      setOrders(data as OrderWithItems[]);
    }
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Real-time subscription
  useEffect(() => {
    if (!storeId) return;

    const channel = supabase
      .channel(`store-orders-${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            fetchOrders();
            playOrderSound();
            const newOrder = payload.new as OrderRow;
            showOrderNotification(newOrder.id, 0);
            toast('🔔 New order received!', { duration: 5000 });
          } else if (payload.eventType === 'UPDATE') {
            setOrders(prev =>
              prev.map(order =>
                order.id === (payload.new as OrderRow).id
                  ? { ...order, ...(payload.new as OrderRow) }
                  : order
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(o => o.id !== (payload.old as any).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId, fetchOrders]);

  const updateOrderStatus = async (
    orderId: string,
    newStatus: string,
    options?: { estimatedPrepTime?: number },
  ) => {
    const patch: Database['public']['Tables']['orders']['Update'] = {
      status: newStatus as OrderRow['status'],
    };
    if (typeof options?.estimatedPrepTime === 'number' && !Number.isNaN(options.estimatedPrepTime)) {
      patch.estimated_prep_time = options.estimatedPrepTime;
    }
    const { error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', orderId);

    if (error) {
      toast.error('Failed to update order status');
    } else {
      toast.success(`Order updated → ${newStatus}`);

      // Smart dispatch: trigger prediction when accepted/preparing
      if (newStatus === 'accepted' || newStatus === 'preparing') {
        supabase.functions.invoke('predict-dispatch-time', {
          body: { order_id: orderId },
        }).then(({ error: fnErr }) => {
          if (fnErr) console.warn('Dispatch prediction failed:', fnErr);
        });
      }
    }
  };

  return { orders, loading, updateOrderStatus, refetch: fetchOrders };
}

const DECLINED_KEY = 'driver_declined_offers_v1';

function loadDeclined(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DECLINED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    // Expire entries older than 2 hours so we don't grow forever
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const fresh: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (ts > cutoff) fresh[id] = ts;
    }
    return fresh;
  } catch {
    return {};
  }
}

function saveDeclined(map: Record<string, number>) {
  try {
    localStorage.setItem(DECLINED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function useDriverOrders(opts: { adminOverride?: boolean } = {}) {
  const { user } = useAuth();
  const adminOverride = !!opts.adminOverride;
  const [offers, setOffers] = useState<OrderWithItems[]>([]);
  const [stackedOffers, setStackedOffers] = useState<OrderWithItems[]>([]);
  const [activeDelivery, setActiveDelivery] = useState<OrderWithItems | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<OrderWithItems[]>([]);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Map of order_id -> pending offer id (only set when assignment_mode='auto')
  const [offerIds, setOfferIds] = useState<Record<string, string>>({});
  const [offerExpiresAt, setOfferExpiresAt] = useState<Record<string, string>>({});
  const [offerTimeoutSec, setOfferTimeoutSec] = useState<number>(60);
  const [assignmentMode, setAssignmentMode] = useState<'auto' | 'manual'>('auto');
  const declinedRef = useRef<Record<string, number>>(loadDeclined());

  const fetchOrders = useCallback(async () => {
    if (!user) return;

    // Load assignment mode via public RPC (avoids exposing all platform_settings)
    const { data: settings } = await (supabase as any).rpc('get_platform_settings_public');
    const row = Array.isArray(settings) ? settings[0] : settings;
    const mode = (row?.assignment_mode === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual';
    setAssignmentMode(mode);
    const tmo = Number(row?.dist_offer_timeout_seconds);
    if (Number.isFinite(tmo) && tmo > 0) setOfferTimeoutSec(tmo);

    // Fetch ALL active orders for this driver (stacked routing supports up to 3).
    // The "primary" activeDelivery is the order with the lowest stop_sequence
    // (= next stop on the smart route); fallback to oldest if no sequence.
    const { data: activeRows } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('driver_id', user.id)
      .in('status', ['accepted', 'preparing', 'ready', 'arrived', 'picked_up'])
      .order('stop_sequence', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(3);

    const activeList = (activeRows as OrderWithItems[] | null) ?? [];
    const active = activeList[0] ?? null;

    setActiveDeliveries(activeList);
    setCurrentBatchId((active as any)?.batch_id ?? null);
    setActiveDelivery(active);


    let availableOrders: OrderWithItems[] = [];
    const nextOfferIds: Record<string, string> = {};
    const nextExpires: Record<string, string> = {};

    if (adminOverride) {
      // ADMIN OVERRIDE: ops queue shows EVERY active order — assigned or not —
      // so admins can claim/steal any order regardless of who currently has it.
      const { data: all } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .in('status', ['placed', 'accepted', 'preparing', 'ready'])
        .order('created_at', { ascending: false })
        .limit(50);
      // Hide orders the admin themself is already actively delivering
      availableOrders = ((all as OrderWithItems[]) ?? []).filter(
        (o) => o.driver_id !== user.id,
      );
    } else if (mode === 'auto') {
      // AUTO MODE: show two buckets, merged into one list:
      //   (a) orders specifically OFFERED to this driver by the dispatcher
      //   (b) BROADCAST orders — manual/external custom orders that are open
      //       to any online driver. Drivers see them as soon as the store
      //       creates them (placed/accepted/preparing) so they can plan ahead,
      //       but they can only actually claim once status === 'ready'.
      const nowIso = new Date().toISOString();

      const [{ data: myPending }, { data: broadcast }] = await Promise.all([
        supabase
          .from('pending_offers')
          .select('id, order_id, expires_at')
          .eq('driver_id', user.id)
          .eq('status', 'pending')
          .gt('expires_at', nowIso),
        supabase
          .from('orders')
          .select('*, order_items(*)')
          .is('driver_id', null)
          .or('source.in.(manual,efood,wolt,box,other,external),payment_method.eq.external')
          .in('status', ['placed', 'accepted', 'preparing', 'ready'])
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const orderIds = (myPending ?? []).map((p) => p.order_id);
      let offered: OrderWithItems[] = [];
      if (orderIds.length > 0) {
        const { data: ord } = await supabase
          .from('orders')
          .select('*, order_items(*)')
          .in('id', orderIds)
          .is('driver_id', null)
          .in('status', ['placed', 'accepted', 'preparing', 'ready']);
        offered = (ord as OrderWithItems[]) ?? [];
        for (const p of myPending ?? []) {
          nextOfferIds[p.order_id] = p.id;
          if (p.expires_at) nextExpires[p.order_id] = p.expires_at as string;
        }
      }

      const broadcastFiltered = ((broadcast as OrderWithItems[]) ?? []).filter(
        (o) => !declinedRef.current[o.id],
      );

      // Merge, dedupe by id (offered takes precedence so we keep the offer id)
      const seen = new Set<string>();
      availableOrders = [];
      for (const o of [...offered, ...broadcastFiltered]) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        availableOrders.push(o);
      }
    } else {
      // MANUAL MODE: legacy free-for-all
      const { data: available } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .is('driver_id', null)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(10);
      availableOrders = available
        ? (available as OrderWithItems[]).filter((o) => !declinedRef.current[o.id])
        : [];
    }

    if (availableOrders.length > 0) {
      const storeIds = Array.from(new Set(availableOrders.map((o) => o.store_id).filter(Boolean)));
      const { data: stores } = await supabase
        .from('stores')
        .select('id, name, address')
        .in('id', storeIds);
      const storeMap = new Map((stores ?? []).map((s) => [s.id, s]));
      availableOrders = availableOrders.map((order) => {
        const store = storeMap.get(order.store_id);
        return store ? { ...order, store_name: store.name, store_address: store.address } : order;
      });
    }

    setOfferIds(nextOfferIds);
    setOfferExpiresAt(nextExpires);

    const MAX_STACK = Number(row?.max_stacked_orders ?? 3);
    const remainingCapacity = Math.max(0, MAX_STACK - activeList.length);

    if (active && remainingCapacity > 0) {
      // Driver has active deliveries but still has room — surface stacked offers
      // from any store they're already heading to (same-store only) and only
      // while at least one pickup is still pending on that store.
      const activeStoreIds = new Set(
        activeList
          .filter((o) => ['accepted', 'preparing', 'ready', 'arrived'].includes(o.status as string))
          .map((o) => o.store_id),
      );
      const activeIds = new Set(activeList.map((o) => o.id));
      const sameStore = availableOrders.filter(
        (o) => activeStoreIds.has(o.store_id) && !activeIds.has(o.id) && o.status === 'ready',
      ).slice(0, remainingCapacity);
      setStackedOffers(sameStore);
      setOffers([]);
    } else if (active) {
      // At capacity — no more offers
      setStackedOffers([]);
      setOffers([]);
    } else {
      // No active delivery → only surface ONE offer at a time.
      // Stacked offers (2nd/3rd) only appear after the driver accepts the first.
      // Prefer offers with a real pending_offer and the soonest expiry.
      const sorted = [...availableOrders].sort((a, b) => {
        const aOffered = nextOfferIds[a.id] ? 0 : 1;
        const bOffered = nextOfferIds[b.id] ? 0 : 1;
        if (aOffered !== bOffered) return aOffered - bOffered;
        const aExp = nextExpires[a.id] ? new Date(nextExpires[a.id]).getTime() : Infinity;
        const bExp = nextExpires[b.id] ? new Date(nextExpires[b.id]).getTime() : Infinity;
        if (aExp !== bExp) return aExp - bExp;
        return new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime();
      });
      setOffers(sorted.slice(0, 1));
      setStackedOffers([]);
    }


    setLoading(false);
  }, [user, adminOverride]);

  useEffect(() => {
    fetchOrders();
    // Realtime handles immediate updates; long safety-net poll only.
    const interval = setInterval(fetchOrders, 120_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);


  // Persistent alert: keep ringing every ~4s while there are unaccepted
  // offers. Triggered only when the set of offer IDs changes — not on
  // every offers array reference (prevents overlapping plays on refetch).
  // NOTE: We rely on `playOfferAlert` only for sound — no extra OS-level
  // notification sound here, to avoid the "double sound" issue.
  const ringableKey = offers.map(o => o.id).sort().join(',');
  useEffect(() => {
    if (activeDelivery) return;
    if (!ringableKey) return;
    playOfferAlert();
    const id = setInterval(() => playOfferAlert(), 4000);
    return () => clearInterval(id);
  }, [ringableKey, activeDelivery]);

  // Real-time: listen for new available orders + new pending offers.
  // We debounce refetches so a burst of order updates doesn't cause a
  // refetch storm (one update per row otherwise).
  useEffect(() => {
    if (!user) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        fetchOrders();
      }, 400);
    };

    const isRelevant = (row: Partial<OrderRow> | null | undefined) => {
      if (!row) return false;
      if (adminOverride) return true;
      if (row.driver_id === user.id) return true;
      if (row.driver_id == null) return true;
      return false;
    };

    const ordersChannel = supabase
      .channel(`driver-orders-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          if (isRelevant(payload.new as OrderRow) || isRelevant(payload.old as OrderRow)) {
            scheduleRefetch();
          }
        }
      )
      .subscribe();

    const offersChannel = supabase
      .channel(`driver-offers-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pending_offers',
          filter: `driver_id=eq.${user.id}`,
        },
        () => {
          // Just refetch — the ringableKey effect handles sound/vibration.
          // Removing the duplicate OS notification here fixes the
          // "double sound" the driver was hearing.
          fetchOrders();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pending_offers',
          filter: `driver_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { order_id?: string; status?: string; expires_at?: string } | null;
          const oldRow = payload.old as { order_id?: string } | null;
          if (!row) return;
          // Status moved away from pending (accepted/declined/expired/cancelled) → refetch.
          if (row.status && row.status !== 'pending') {
            scheduleRefetch();
            return;
          }
          // Expiry adjusted while still pending → patch countdown source in place.
          const orderId = row.order_id ?? oldRow?.order_id;
          if (orderId && row.expires_at) {
            setOfferExpiresAt((prev) =>
              prev[orderId] === row.expires_at ? prev : { ...prev, [orderId]: row.expires_at as string },
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'pending_offers',
          filter: `driver_id=eq.${user.id}`,
        },
        () => {
          // Offer cancelled / cleaned up → drop it from the UI immediately.
          scheduleRefetch();
        }
      )
      .subscribe();



    return () => {
      if (pending) clearTimeout(pending);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(offersChannel);
    };
  }, [user, fetchOrders, adminOverride]);

  const acceptOrder = async (orderId: string) => {
    if (!user) return;
    const offerId = offerIds[orderId];
    // Drivers may now soft-accept an order even before the store marks it
    // ready — physical pickup is still gated server-side by the store's
    // `ready` status (see project memory: driver Accept is a soft reservation).

    // ADMIN PRIORITY: admins always win — they can claim/steal any order
    // directly, even if a driver already has it. Bypass the offer-accept flow.
    if (adminOverride) {
      const patch: Database['public']['Tables']['orders']['Update'] = {
        driver_id: user.id,
        status: 'accepted',
        stacked_with_order_id: null,
      };
      const { error } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', orderId);

      if (error) {
        toast.error('Failed to claim order');
      } else {
        fetchOrders();
      }
      return;
    }

    // AUTO mode with offer → use atomic accept-offer edge function
    if (assignmentMode === 'auto' && offerId) {
      const { data, error } = await supabase.functions.invoke('accept-offer', {
        body: { offer_id: offerId },
      });
      if (error || (data && (data as { error?: string }).error)) {
        const msg = (data as { error?: string })?.error ?? error?.message ?? 'Failed to accept';
        toast.error(msg === 'order already taken' ? 'Order already taken by another driver' : 'Failed to accept order');
        fetchOrders();
        return;
      }
      fetchOrders();
      return;
    }

    // MANUAL mode (or stacked offer with no pending_offer) → legacy direct claim
    const isStacking = !!activeDelivery && activeDelivery.id !== orderId;
    const patch: Database['public']['Tables']['orders']['Update'] = {
      driver_id: user.id,
      status: 'accepted',
    };
    if (isStacking) patch.stacked_with_order_id = activeDelivery!.id;

    const { error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', orderId);


    if (error) {
      toast.error('Failed to accept order');
    } else {
      supabase.from('driver_offer_events').insert({
        driver_id: user.id,
        order_id: orderId,
        action: 'accepted',
      }).then(() => {});
      fetchOrders();
    }
  };

  const declineOrder = async (orderId: string) => {
    if (!user) return;
    const offerId = offerIds[orderId];

    if (assignmentMode === 'auto' && offerId) {
      // AUTO: tell the dispatcher so it can advance immediately
      await supabase.functions.invoke('decline-offer', { body: { offer_id: offerId } });
      setOffers(prev => prev.filter(o => o.id !== orderId));
      setStackedOffers(prev => prev.filter(o => o.id !== orderId));
      return;
    }

    // MANUAL: persist client-side decline + log event
    declinedRef.current[orderId] = Date.now();
    saveDeclined(declinedRef.current);
    supabase.from('driver_offer_events').insert({
      driver_id: user.id,
      order_id: orderId,
      action: 'declined',
    }).then(() => {});
    setOffers(prev => prev.filter(o => o.id !== orderId));
    setStackedOffers(prev => prev.filter(o => o.id !== orderId));
  };

  const updateDeliveryStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus as OrderRow['status'] })
      .eq('id', orderId);


    if (error) {
      console.error('[updateDeliveryStatus]', { orderId, newStatus, error });
      toast.error(`Σφάλμα: ${error.message ?? 'Failed to update status'}`);
    } else {
      // When a stop is completed, re-run the optimizer so the remaining stops
      // are re-sequenced from the driver's current position.
      if (['picked_up', 'delivered'].includes(newStatus) && currentBatchId) {
        supabase.functions.invoke('optimize-route', { body: { batch_id: currentBatchId } })
          .catch(() => {});
      }
      if (newStatus === 'delivered') {
        // Only clear if it was the primary active. Fetch will reconcile.
        setActiveDelivery(prev => prev?.id === orderId ? null : prev);
        setActiveDeliveries(prev => prev.filter(o => o.id !== orderId));
      }
      fetchOrders();
    }
  };

  return {
    offers,
    stackedOffers,
    activeDelivery,
    activeDeliveries,
    currentBatchId,
    loading,
    acceptOrder,
    declineOrder,
    updateDeliveryStatus,
    refetch: fetchOrders,
    assignmentMode,
    offerIds,
    offerExpiresAt,
    offerTimeoutSec,
  };
}


export function useUserStore() {
  const { user } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('stores')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)
      .single()
      .then(({ data }) => {
        setStoreId(data?.id ?? null);
        setLoading(false);
      });
  }, [user]);

  return { storeId, loading };
}
