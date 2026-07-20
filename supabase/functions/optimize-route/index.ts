// Smart route optimizer for a driver's active batch.
// Input:  { driver_id } OR { batch_id }
// Output: { batch_id, stops: [{ order_id, type, sequence, lat, lng }] }
//
// Algorithm: greedy nearest-neighbor over remaining pickups + dropoffs, with the
// hard constraint that a dropoff can only be visited after its pickup. Good
// enough for ≤6 stops (i.e. 3 orders × 2 stops).
//
// Side-effect: writes the optimized `stop_sequence` back onto each order in the
// batch (1..N across pickups+dropoffs combined). The driver's "next stop" is
// the order whose remaining work matches sequence = MIN(stop_sequence)
// among orders that aren't yet picked-up/delivered.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Stop {
  order_id: string;
  type: "pickup" | "dropoff";
  lat: number;
  lng: number;
  sequence?: number;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function optimize(start: { lat: number; lng: number }, stops: Stop[]): Stop[] {
  const remaining = [...stops];
  const out: Stop[] = [];
  const pickedUp = new Set<string>();
  let cur = start;

  while (remaining.length > 0) {
    // Eligible = pickups, OR dropoffs whose pickup is already done
    const eligible = remaining.filter((s) => s.type === "pickup" || pickedUp.has(s.order_id));
    const pool = eligible.length > 0 ? eligible : remaining;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineKm(cur, pool[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const chosen = pool[bestIdx];
    out.push(chosen);
    if (chosen.type === "pickup") pickedUp.add(chosen.order_id);
    cur = { lat: chosen.lat, lng: chosen.lng };
    const removeIdx = remaining.indexOf(chosen);
    remaining.splice(removeIdx, 1);
  }
  return out.map((s, i) => ({ ...s, sequence: i + 1 }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "missing auth" }, 401);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = authHeader === `Bearer ${serviceKey}`;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  let resolvedDriverId: string | null = null;
  if (!isService) {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    resolvedDriverId = user.id;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const driverId = (body.driver_id as string | undefined) ?? resolvedDriverId;
    const explicitBatchId = body.batch_id as string | undefined;
    if (!driverId && !explicitBatchId) return json({ error: "driver_id or batch_id required" }, 400);


    // 1) Load the driver's active orders (or the batch's orders)
    let q = admin
      .from("orders")
      .select("id, batch_id, store_id, status, delivery_latitude, delivery_longitude")
      .in("status", ["accepted", "preparing", "ready", "arrived", "picked_up"]);
    q = explicitBatchId ? q.eq("batch_id", explicitBatchId) : q.eq("driver_id", driverId);
    const { data: orders } = await q;
    if (!orders || orders.length === 0) {
      return json({ ok: true, batch_id: null, stops: [] });
    }

    // 2) Resolve store coords
    const storeIds = [...new Set(orders.map((o) => o.store_id).filter(Boolean))];
    const { data: stores } = await admin
      .from("stores")
      .select("id, latitude, longitude")
      .in("id", storeIds);
    const storeMap = new Map((stores ?? []).map((s) => [s.id, s]));

    // 3) Build stops: pickup unless already picked_up; always dropoff
    const stops: Stop[] = [];
    for (const o of orders) {
      const store = storeMap.get(o.store_id);
      if (o.status !== "picked_up" && store?.latitude != null && store?.longitude != null) {
        stops.push({ order_id: o.id, type: "pickup", lat: Number(store.latitude), lng: Number(store.longitude) });
      }
      if (o.delivery_latitude != null && o.delivery_longitude != null) {
        stops.push({ order_id: o.id, type: "dropoff", lat: Number(o.delivery_latitude), lng: Number(o.delivery_longitude) });
      }
    }

    // 4) Driver start position — resolve driver from any order if not provided
    let effectiveDriverId: string | null = driverId ?? null;
    if (!effectiveDriverId) {
      const { data: anyOrder } = await admin
        .from("orders")
        .select("driver_id")
        .eq("batch_id", explicitBatchId!)
        .not("driver_id", "is", null)
        .limit(1)
        .maybeSingle();
      effectiveDriverId = (anyOrder as any)?.driver_id ?? null;
    }
    const { data: loc } = effectiveDriverId
      ? await admin
          .from("driver_locations")
          .select("latitude, longitude")
          .eq("driver_id", effectiveDriverId)
          .maybeSingle()
      : { data: null };
    const start = {
      lat: loc?.latitude != null ? Number(loc.latitude) : (stops[0]?.lat ?? 0),
      lng: loc?.longitude != null ? Number(loc.longitude) : (stops[0]?.lng ?? 0),
    };

    // 5) Optimize
    const sequenced = optimize(start, stops);

    // 6) Persist: stop_sequence = sequence of the order's NEXT remaining stop
    //    (pickup if not yet picked up, else dropoff)
    const nextSeqByOrder = new Map<string, number>();
    for (const s of sequenced) {
      if (!nextSeqByOrder.has(s.order_id)) nextSeqByOrder.set(s.order_id, s.sequence!);
    }
    // Ensure each order has at least one entry
    for (const o of orders) {
      if (!nextSeqByOrder.has(o.id)) nextSeqByOrder.set(o.id, 999);
    }

    // Assign or reuse a batch_id
    let batchId = explicitBatchId ?? orders.find((o) => o.batch_id)?.batch_id ?? null;
    if (!batchId) {
      batchId = crypto.randomUUID();
    }

    await Promise.all(
      [...nextSeqByOrder.entries()].map(([orderId, seq]) =>
        admin.from("orders").update({ batch_id: batchId, stop_sequence: seq }).eq("id", orderId),
      ),
    );

    return json({ ok: true, batch_id: batchId, stops: sequenced });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
