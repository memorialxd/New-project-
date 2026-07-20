// Auto-dispatch engine
// Run on a cron every ~30s. For each order needing dispatch:
//   - if no live offers → start wave 1 with N nearest eligible drivers
//   - if all wave offers expired/declined → advance to next wave
//   - if max waves exhausted → leave as-is (admin fallback)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthedUser, hasCronSecret, unauthorized } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Settings {
  assignment_mode: string;
  dist_offer_timeout_seconds: number;
  dist_wave_size: number;
  dist_max_waves: number;
}

interface OrderRow {
  id: string;
  store_id: string;
  driver_id: string | null;
  total_amount: number;
  status: string;
  dispatch_at: string | null;
}

interface StoreLoc {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

interface CandidateDriver {
  driver_id: string;
  distance_km: number;
  score: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Allow internal callers: pg_cron job (sends our project's anon JWT in apikey),
  // CRON_SECRET, or admin user.
  const apikeyHeader = req.headers.get("apikey") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https?:\/\/([^.]+)\./)?.[1] ?? "";
  const looksLikeProjectAnonJwt = (token: string): boolean => {
    if (!token || token.split(".").length !== 3) return false;
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.ref === projectRef && (payload?.role === "anon" || payload?.role === "service_role");
    } catch { return false; }
  };
  // Internal cron callers may send the project anon JWT in EITHER the apikey
  // header OR the Authorization Bearer header (pg_cron net.http_post varies).
  const isInternalCron =
    looksLikeProjectAnonJwt(apikeyHeader) || looksLikeProjectAnonJwt(bearerToken);
  if (!isInternalCron && !hasCronSecret(req)) {
    const user = await getAuthedUser(req);
    if (!user?.isAdmin) {
      console.warn("auto-dispatch unauthorized", {
        hasApikey: !!apikeyHeader,
        hasAuth: !!authHeader,
        apikeyLooksProject: looksLikeProjectAnonJwt(apikeyHeader),
        bearerLooksProject: looksLikeProjectAnonJwt(bearerToken),
        projectRef,
      });
      return unauthorized(corsHeaders);
    }
  }



  const admin = createClient(supabaseUrl, serviceKey);
  const startedAt = new Date();
  const source = isInternalCron ? "cron" : "manual";

  // We only persist a dispatch_runs row when the run actually did something
  // (dispatched, expired, errored, or was a manual/admin call). This keeps
  // the table from filling up with thousands of empty cron no-ops.
  const logFinish = async (payload: Record<string, unknown>, success: boolean, errorMsg?: string) => {
    const dispatched = Number(payload.dispatched ?? 0);
    const expired = Number(payload.expired ?? 0);
    const isNoop = success && dispatched === 0 && expired === 0 && !errorMsg;
    // For cron no-ops, skip the insert entirely.
    if (source === "cron" && isNoop) return;
    try {
      await admin.from("dispatch_runs").insert({
        source,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        success,
        dispatched,
        expired,
        duration_ms: Date.now() - startedAt.getTime(),
        error: errorMsg ?? null,
        details: payload,
      });
    } catch (_) { /* logging best-effort */ }
  };


  try {
    // 1) Load settings
    const { data: settings } = await admin
      .from("platform_settings")
      .select("assignment_mode, dist_offer_timeout_seconds, dist_wave_size, dist_max_waves, auto_dispatch_enabled")
      .eq("id", 1)
      .single();

    // Admin kill-switch: cron-driven calls early-exit when disabled.
    // Manual "Force dispatch" from the admin panel always runs (carries Authorization header).
    if (isInternalCron && settings && (settings as { auto_dispatch_enabled?: boolean }).auto_dispatch_enabled === false) {
      const payload = { ok: true, dispatched: 0, skipped: "auto_dispatch_disabled" };
      await logFinish(payload, true);
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const s: Settings = {
      assignment_mode: settings?.assignment_mode ?? "auto",
      dist_offer_timeout_seconds: settings?.dist_offer_timeout_seconds ?? 30,
      dist_wave_size: settings?.dist_wave_size ?? 3,
      dist_max_waves: settings?.dist_max_waves ?? 3,
    };

    // 2) Expire stale pending offers
    const { data: expired } = await admin
      .from("pending_offers")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString())
      .select("id, order_id, driver_id");

    // Log expired offers as decline events (counts against acceptance rate)
    if (expired && expired.length > 0) {
      await admin.from("driver_offer_events").insert(
        expired.map((e) => ({
          driver_id: e.driver_id,
          order_id: e.order_id,
          action: "expired",
        })),
      );
    }

    // 3) In manual mode we still expire offers above but stop here
    if (s.assignment_mode !== "auto") {
      const payload = { ok: true, mode: "manual", expired: expired?.length ?? 0 };
      await logFinish(payload, true);
      return json(payload);
    }

    // 4) Find orders needing dispatch — offer ASAP, no waiting on predicted
    //    ready time. Any unassigned order in an active pre-pickup status is
    //    eligible immediately so drivers can be assigned without delay.
    const { data: candidates } = await admin
      .from("orders")
      .select("id, store_id, driver_id, total_amount, status, dispatch_at, predicted_ready_at")
      .is("driver_id", null)
      .in("status", ["placed", "accepted", "preparing", "ready"])
      .order("created_at", { ascending: true })
      .limit(50);


    const orders = (candidates ?? []) as OrderRow[];
    if (orders.length === 0) {
      const payload = { ok: true, mode: "auto", dispatched: 0, expired: expired?.length ?? 0 };
      await logFinish(payload, true);
      return json(payload);
    }

    // 5) Filter out orders that already have a live pending offer
    const orderIds = orders.map((o) => o.id);
    const { data: liveOffers } = await admin
      .from("pending_offers")
      .select("order_id, driver_id, wave")
      .in("order_id", orderIds)
      .eq("status", "pending");

    const liveByOrder = new Map<string, { driver_id: string; wave: number }[]>();
    for (const o of liveOffers ?? []) {
      const arr = liveByOrder.get(o.order_id) ?? [];
      arr.push({ driver_id: o.driver_id, wave: o.wave });
      liveByOrder.set(o.order_id, arr);
    }

    // 6) Get the highest wave already attempted per order (for advancing)
    const { data: pastOffers } = await admin
      .from("pending_offers")
      .select("order_id, driver_id, wave, status")
      .in("order_id", orderIds);

    const waveByOrder = new Map<string, number>();
    const triedDrivers = new Map<string, Set<string>>();
    for (const p of pastOffers ?? []) {
      waveByOrder.set(p.order_id, Math.max(waveByOrder.get(p.order_id) ?? 0, p.wave));
      const set = triedDrivers.get(p.order_id) ?? new Set();
      set.add(p.driver_id);
      triedDrivers.set(p.order_id, set);
    }

    // 6b) Per-driver 10s cooldown after declining/expiring ANY offer.
    // Gives someone else a chance and avoids spamming the same driver.
    const COOLDOWN_MS = 10_000;
    const cooldownSince = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { data: recentEvents } = await admin
      .from("driver_offer_events")
      .select("driver_id, created_at, action")
      .in("action", ["declined", "expired"])
      .gte("created_at", cooldownSince);
    const cooledOff = new Set<string>((recentEvents ?? []).map((e: any) => e.driver_id));

    // 7) Load store + delivery locations. For external orders the store may
    // not have coords yet — fall back to the customer's delivery coords as the
    // dispatch anchor so we still produce offers.
    const ordersToDispatch = orders.filter((o) => !liveByOrder.has(o.id));
    const storeIds = [...new Set(ordersToDispatch.map((o) => o.store_id))];
    const orderIdsToDispatch = ordersToDispatch.map((o) => o.id);
    const [{ data: stores }, { data: orderLocs }] = await Promise.all([
      admin.from("stores").select("id, latitude, longitude").in("id", storeIds),
      admin
        .from("orders")
        .select("id, delivery_latitude, delivery_longitude")
        .in("id", orderIdsToDispatch),
    ]);
    const storeMap = new Map<string, StoreLoc>((stores ?? []).map((s: StoreLoc) => [s.id, s]));
    const orderLocMap = new Map<string, { lat: number | null; lng: number | null }>(
      (orderLocs ?? []).map(
        (o: { id: string; delivery_latitude: number | null; delivery_longitude: number | null }) => [
          o.id,
          { lat: o.delivery_latitude, lng: o.delivery_longitude },
        ],
      ),
    );

    let dispatched = 0;
    const dispatchResults: Record<string, unknown>[] = [];

    for (const order of ordersToDispatch) {
      const store = storeMap.get(order.store_id);
      const dropoff = orderLocMap.get(order.id);
      const anchorLat = store?.latitude ?? dropoff?.lat ?? null;
      const anchorLng = store?.longitude ?? dropoff?.lng ?? null;
      if (anchorLat == null || anchorLng == null) {
        dispatchResults.push({ order: order.id, skipped: "no anchor location (store + delivery both missing)" });
        continue;
      }

      const currentWave = waveByOrder.get(order.id) ?? 0;
      // No order left behind: when we exhaust the configured wave count, we
      // restart with a fresh driver pool but keep wave numbers increasing so
      // repeated offers do not collide with the unique offer history.
      let cycleExhausted = currentWave >= s.dist_max_waves;
      let nextWave = currentWave + 1;
      // Always exclude drivers in the 10s cooldown window so the same driver
      // is not re-spammed right after declining/expiring an offer.
      const orderTried = cycleExhausted ? new Set<string>() : new Set(triedDrivers.get(order.id) ?? []);
      for (const d of cooledOff) orderTried.add(d);
      let exclude = [...orderTried];

      const fetchCandidates = async (excludeList: string[]): Promise<CandidateDriver[]> => {
        let list: CandidateDriver[] = [];
        const { data: primary } = await admin.rpc("nearby_active_drivers", {
          _store_lat: anchorLat,
          _store_lng: anchorLng,
          _order_value: Number(order.total_amount ?? 0),
          _exclude_drivers: excludeList,
          _limit: s.dist_wave_size,
          _store_id: order.store_id,
          _dropoff_lat: dropoff?.lat ?? null,
          _dropoff_lng: dropoff?.lng ?? null,
        });
        list = (primary ?? []) as CandidateDriver[];

        if (list.length === 0 && dropoff?.lat != null && dropoff?.lng != null) {
          const { data: dropoffDrivers } = await admin.rpc("nearby_active_drivers", {
            _store_lat: dropoff.lat,
            _store_lng: dropoff.lng,
            _order_value: Number(order.total_amount ?? 0),
            _exclude_drivers: excludeList,
            _limit: s.dist_wave_size,
            _store_id: order.store_id,
            _dropoff_lat: dropoff.lat,
            _dropoff_lng: dropoff.lng,
          });
          list = (dropoffDrivers ?? []) as CandidateDriver[];
        }

        if (list.length === 0) {
          list = await loadAvailableOnlineDrivers(admin, anchorLat, anchorLng, excludeList, s.dist_wave_size);
        }
        return list;
      };


      let candidateDrivers = await fetchCandidates(exclude);

      // If exclude list ate up all online drivers, reset the cycle immediately
      // and re-offer to everyone again (but still respect the 10s cooldown).
      if (candidateDrivers.length === 0 && exclude.length > 0) {
        exclude = [...cooledOff];
        cycleExhausted = true;
        candidateDrivers = await fetchCandidates(exclude);
      }

      if (!candidateDrivers || candidateDrivers.length === 0) {
        dispatchResults.push({ order: order.id, skipped: `no eligible drivers (wave ${nextWave})` });
        continue;
      }

      const expiresAt = new Date(Date.now() + s.dist_offer_timeout_seconds * 1000).toISOString();
      const offers = candidateDrivers.map((d: CandidateDriver) => ({
        order_id: order.id,
        driver_id: d.driver_id,
        wave: nextWave,
        status: "pending",
        distance_km: d.distance_km,
        score: d.score,
        expires_at: expiresAt,
      }));

      const { error: insErr } = await admin.from("pending_offers").insert(offers);
      if (insErr) {
        dispatchResults.push({ order: order.id, error: insErr.message });
        continue;
      }

      dispatched++;
      dispatchResults.push({
        order: order.id,
        wave: nextWave,
        offered_to: candidateDrivers.length,
      });
    }

    const payload = {
      ok: true,
      mode: "auto",
      expired: expired?.length ?? 0,
      dispatched,
      details: dispatchResults,
    };
    await logFinish(payload, true);
    return json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const payload = { ok: false, error: msg };
    await logFinish(payload, false, msg);
    return json(payload, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadAvailableOnlineDrivers(
  admin: ReturnType<typeof createClient>,
  anchorLat: number,
  anchorLng: number,
  exclude: string[],
  limit: number,
): Promise<CandidateDriver[]> {
  // Get all active drivers with their current location and active order count
  const { data } = await admin
    .from("driver_profiles")
    .select("user_id, driver_locations(latitude, longitude, updated_at), driver_state(on_break, is_online)")
    .eq("is_active", true)
    .is("suspended_at", null)
    .limit(Math.max(limit * 8, limit));

  // Get drivers with active orders (those already have a delivery in progress)
  const { data: busyDrivers } = await admin
    .from("orders")
    .select("driver_id")
    .in("status", ["accepted", "preparing", "ready", "arrived", "picked_up"])
    .not("driver_id", "is", null);

  const busyDriverSet = new Set((busyDrivers ?? []).map((o: any) => o.driver_id));

  return (data ?? [])
    // Exclude: drivers in the exclude list, drivers on break, drivers with active orders
    .filter((row: any) => 
      !exclude.includes(row.user_id) && 
      !row.driver_state?.on_break &&
      !busyDriverSet.has(row.user_id)
    )
    .map((row: any) => {
      const loc = Array.isArray(row.driver_locations) ? row.driver_locations[0] : row.driver_locations;
      const lat = loc?.latitude != null ? Number(loc.latitude) : null;
      const lng = loc?.longitude != null ? Number(loc.longitude) : null;
      // If no recent GPS, still offer (assume far) so order doesn't sit unassigned.
      const distance = lat != null && lng != null
        ? haversineKm(anchorLat, anchorLng, lat, lng)
        : 9999;
      return { driver_id: row.user_id, distance_km: Number(distance.toFixed(2)), score: Number(distance.toFixed(3)) };
    })
    .sort((a: CandidateDriver, b: CandidateDriver) => a.score - b.score)
    .slice(0, limit);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
