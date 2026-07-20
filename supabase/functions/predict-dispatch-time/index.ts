import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthedUser, hasCronSecret, unauthorized } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Travel speed assumptions (km/h) by vehicle / general avg
const AVG_DRIVER_SPEED_KMH = 28;
// Buffer subtracted so driver arrives slightly BEFORE food is ready (in min)
const ARRIVAL_BUFFER_MIN = 2;
// Min/max sane prep prediction
const MIN_PREP = 5;
const MAX_PREP = 90;

interface RequestBody {
  order_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Require either an authenticated user (any role — customers call this right
    // after creating their order) OR a valid CRON_SECRET for internal callers.
    if (!hasCronSecret(req)) {
      const user = await getAuthedUser(req);
      if (!user) return unauthorized(corsHeaders);
    }

    const { order_id } = (await req.json()) as RequestBody;
    if (!order_id) throw new Error("order_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load order
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .select("id, store_id, total_amount, distance_km, estimated_prep_time, created_at, status")
      .eq("id", order_id)
      .maybeSingle();
    if (oErr || !order) throw new Error("Order not found");

    // Historical avg prep
    const { data: avgData } = await supabase.rpc("get_store_avg_prep_minutes", {
      p_store_id: order.store_id,
    });
    const historicalAvg = Number(avgData ?? 20);

    // Current store load (active orders not yet ready)
    const { count: activeCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", order.store_id)
      .in("status", ["placed", "accepted", "preparing"]);
    const load = activeCount ?? 0;

    // ML/heuristic prediction blend
    // Base = max(store estimate, historical avg)
    let predictedPrep = Math.max(
      Number(order.estimated_prep_time ?? 0) || 0,
      historicalAvg,
    );
    // Add load factor: +1.5 min per pending order beyond 2
    if (load > 2) predictedPrep += (load - 2) * 1.5;
    // Add complexity factor: large orders take longer
    const total = Number(order.total_amount ?? 0);
    if (total > 40) predictedPrep += 3;
    if (total > 80) predictedPrep += 4;

    // Ask Lovable AI to refine if available (optional, fast model)
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (apiKey) {
      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content:
                  "You predict food prep time in minutes. Respond ONLY via the tool call. Be realistic.",
              },
              {
                role: "user",
                content: `Predict prep time. Store historical avg: ${historicalAvg.toFixed(1)} min. Store estimate: ${order.estimated_prep_time ?? "n/a"} min. Active orders queued: ${load}. Order total: €${total.toFixed(2)}. Heuristic prediction: ${predictedPrep.toFixed(1)} min.`,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "submit_prediction",
                  description: "Submit predicted prep minutes",
                  parameters: {
                    type: "object",
                    properties: {
                      prep_minutes: { type: "number" },
                    },
                    required: ["prep_minutes"],
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "submit_prediction" } },
          }),
        });
        if (aiResp.ok) {
          const j = await aiResp.json();
          const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          if (args) {
            const parsed = JSON.parse(args);
            if (typeof parsed.prep_minutes === "number") {
              // Blend AI 50/50 with heuristic
              predictedPrep = (predictedPrep + parsed.prep_minutes) / 2;
            }
          }
        }
      } catch (e) {
        console.warn("AI refinement skipped:", e);
      }
    }

    predictedPrep = Math.max(MIN_PREP, Math.min(MAX_PREP, Math.round(predictedPrep)));

    // Travel time to store from typical driver position (use distance_km as proxy round-trip, not perfect)
    const km = Number(order.distance_km ?? 2);
    const travelMin = Math.max(3, Math.round((km / AVG_DRIVER_SPEED_KMH) * 60));

    // Dispatch should happen at: ready_time - travelMin - buffer
    const readyTime = new Date(order.created_at).getTime() + predictedPrep * 60_000;
    const dispatchMs = readyTime - travelMin * 60_000 - ARRIVAL_BUFFER_MIN * 60_000;
    const dispatchAt = new Date(Math.max(Date.now(), dispatchMs)).toISOString();

    // Persist
    const { error: uErr } = await supabase.rpc("set_order_dispatch", {
      p_order_id: order_id,
      p_dispatch_at: dispatchAt,
      p_predicted_prep_minutes: predictedPrep,
    });
    if (uErr) throw uErr;

    return new Response(
      JSON.stringify({
        order_id,
        predicted_prep_minutes: predictedPrep,
        travel_minutes: travelMin,
        dispatch_at: dispatchAt,
        historical_avg: historicalAvg,
        active_load: load,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("predict-dispatch-time error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
