// Admin Setting Advisor — analyzes a proposed admin setting change with Lovable AI
// and returns a structured impact assessment that the admin must review before applying.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit, rateLimitResponse, clientKey } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AdvisorRequest {
  setting_area: string;
  setting_label: string;
  setting_key?: string;
  current_value: unknown;
  proposed_value: unknown;
  context?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    // --- AUTH: require admin role ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Rate limit: 30/min per admin (burst 10) ---
    const rl = rateLimit(clientKey(req, userData.user.id), { capacity: 10, refillPerMinute: 30 });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfter, corsHeaders);

    const body = (await req.json()) as AdvisorRequest;
    if (!body || typeof body.setting_area !== "string" || typeof body.setting_label !== "string") {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Είσαι σύμβουλος για διαχειριστές πλατφόρμας delivery. Αναλύεις προτεινόμενες αλλαγές ρυθμίσεων.
Πάντα απαντάς στα ελληνικά, σύντομα και πρακτικά. Επικεντρώσου σε:
- ποιους επηρεάζει (πελάτες/καταστήματα/οδηγούς/admin)
- οικονομικό/λειτουργικό αντίκτυπο
- κινδύνους ή παρενέργειες
- σύσταση: proceed / caution / block (με λόγο)`;

    const userPrompt = `Πρόκειται να αλλάξει η εξής ρύθμιση:

Περιοχή: ${body.setting_area}
Όνομα: ${body.setting_label}${body.setting_key ? ` (${body.setting_key})` : ""}
Τρέχουσα τιμή: ${JSON.stringify(body.current_value)}
Νέα τιμή: ${JSON.stringify(body.proposed_value)}
${body.context ? `Συμπληρωματικά: ${JSON.stringify(body.context)}` : ""}

Δώσε ανάλυση για να αποφασίσει ο admin αν θα προχωρήσει.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_impact",
              description: "Δομημένη αξιολόγηση της προτεινόμενης αλλαγής",
              parameters: {
                type: "object",
                properties: {
                  recommendation: { type: "string", enum: ["proceed", "caution", "block"] },
                  summary: { type: "string" },
                  affected: { type: "array", items: { type: "string" } },
                  impacts: { type: "array", items: { type: "string" } },
                  risks: { type: "array", items: { type: "string" } },
                  reason: { type: "string" },
                },
                required: ["recommendation", "summary", "affected", "impacts", "risks", "reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_impact" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. Δοκίμασε ξανά σε λίγο." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Έλειψαν τα AI credits του workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;

    if (!args) {
      return new Response(JSON.stringify({ error: "Δεν επιστράφηκε ανάλυση" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("advisor error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
