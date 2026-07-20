// Driver accepts a pending offer.
// Atomically: claims the order, marks this offer accepted, cancels sibling offers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing auth" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const offerId = body.offer_id as string | undefined;
    if (!offerId) return json({ error: "offer_id required" }, 400);

    // Verify offer belongs to this driver and is still pending
    const { data: offer } = await admin
      .from("pending_offers")
      .select("id, order_id, driver_id, status, expires_at")
      .eq("id", offerId)
      .single();

    if (!offer || offer.driver_id !== user.id) return json({ error: "offer not found" }, 404);
    if (offer.status !== "pending") return json({ error: "offer already responded" }, 410);
    if (new Date(offer.expires_at).getTime() < Date.now()) {
      return json({ error: "offer expired" }, 410);
    }

    // Atomic claim (soft reservation): only succeeds if order still unassigned.
    // Physical pickup is gated elsewhere until the store flips status to 'ready'.
    const { data: claimed, error: claimErr } = await admin
      .from("orders")
      .update({ driver_id: user.id })
      .eq("id", offer.order_id)
      .is("driver_id", null)
      .select("id, status, store_id")
      .maybeSingle();

    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      await admin
        .from("pending_offers")
        .update({ status: "cancelled", responded_at: new Date().toISOString() })
        .eq("id", offerId);
      return json({ error: "order already taken" }, 409);
    }

    // Nudge stale 'placed' → 'accepted' so dashboards reflect a courier is locked in.
    if (claimed.status === "placed") {
      await admin
        .from("orders")
        .update({ status: "accepted" })
        .eq("id", offer.order_id);
    }

    // Mark this offer accepted, cancel siblings
    await admin
      .from("pending_offers")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", offerId);

    await admin
      .from("pending_offers")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("order_id", offer.order_id)
      .eq("status", "pending")
      .neq("id", offerId);

    // Log event
    await admin.from("driver_offer_events").insert({
      driver_id: user.id,
      order_id: offer.order_id,
      action: "accepted",
    });

    // STACKING: if the driver already has other active orders, attach this new
    // order to the existing batch (or create one) and re-run the smart router
    // so the stop sequence is recomputed across all active orders.
    const { data: otherActive } = await admin
      .from("orders")
      .select("id, batch_id")
      .eq("driver_id", user.id)
      .in("status", ["accepted", "preparing", "ready", "arrived", "picked_up"])
      .neq("id", offer.order_id);

    if (otherActive && otherActive.length > 0) {
      const existingBatch = otherActive.find((o) => o.batch_id)?.batch_id ?? crypto.randomUUID();
      // Link this order to the batch; optimizer will recompute stop_sequence
      await admin
        .from("orders")
        .update({ batch_id: existingBatch, stacked_with_order_id: otherActive[0].id })
        .eq("id", offer.order_id);
      // Backfill any siblings missing batch_id
      const missing = otherActive.filter((o) => !o.batch_id).map((o) => o.id);
      if (missing.length > 0) {
        await admin.from("orders").update({ batch_id: existingBatch }).in("id", missing);
      }
      // Fire-and-forget optimize call (admin client → direct function call)
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/optimize-route`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ driver_id: user.id, batch_id: existingBatch }),
        });
      } catch (_) { /* best effort */ }
    }


    return json({ ok: true, order_id: offer.order_id });
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
