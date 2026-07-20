import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit, rateLimitResponse, clientKey } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify support or admin role
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const allowed = roles?.some((r: any) => r.role === "support" || r.role === "admin");
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 30 AI calls per minute per support agent (burst 10)
    const rl = rateLimit(clientKey(req, userData.user.id), { capacity: 10, refillPerMinute: 30 });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfter, corsHeaders);

    const { ticketId, action, customPrompt } = await req.json();

    if (action === "health_check") {
      return new Response(JSON.stringify({ ok: true, service: "support-ai" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ticketId || !action) {
      return new Response(JSON.stringify({ error: "ticketId and action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load ticket + messages + driver info
    const { data: ticket } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", ticketId)
      .maybeSingle();
    if (!ticket) {
      return new Response(JSON.stringify({ error: "Ticket not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: messages } = await supabase
      .from("ticket_messages")
      .select("sender_role, message, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    const { data: driverProfile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", ticket.driver_id)
      .maybeSingle();

    let order: any = null;
    if (ticket.order_id) {
      const { data } = await supabase
        .from("orders")
        .select("id, status, delivery_address, total_amount, distance_km, created_at")
        .eq("id", ticket.order_id)
        .maybeSingle();
      order = data;
    }

    const conversation =
      messages?.map((m: any) => `[${m.sender_role}] ${m.message}`).join("\n") ||
      "(καμία συνομιλία ακόμα)";

    const ticketContext = `
ΠΛΗΡΟΦΟΡΙΕΣ TICKET:
- Κατηγορία: ${ticket.category}
- Κατάσταση: ${ticket.status}
- Περιγραφή οδηγού: ${ticket.description || "(καμία)"}
- Δημιουργήθηκε: ${ticket.created_at}
- Οδηγός: ${driverProfile?.full_name ?? ticket.driver_id} ${driverProfile?.phone ? `(${driverProfile.phone})` : ""}
${order ? `- Σχετική παραγγελία: #${order.id.slice(0, 8)} | status=${order.status} | διεύθυνση=${order.delivery_address} | km=${order.distance_km}` : ""}

ΣΥΝΟΜΙΛΙΑ ΜΕΧΡΙ ΤΩΡΑ:
${conversation}
`.trim();

    let systemPrompt = "";
    let userPrompt = "";

    switch (action) {
      case "suggest_reply":
        systemPrompt =
          "Είσαι έμπειρος agent υποστήριξης για πλατφόρμα delivery. Γράφεις στα ΕΛΛΗΝΙΚΑ, σύντομες, ευγενικές, επαγγελματικές απαντήσεις προς τον οδηγό. Δίνεις πρακτικά βήματα, ζητάς διευκρινίσεις όταν χρειάζεται. Δεν υπόσχεσαι αποζημιώσεις ή επιστροφές χωρίς admin. ΜΟΝΟ το κείμενο της απάντησης, χωρίς εισαγωγές ή σχόλια.";
        userPrompt = `${ticketContext}\n\nΓράψε την επόμενη απάντηση προς τον οδηγό.`;
        break;
      case "summarize":
        systemPrompt =
          "Συνοψίζεις tickets υποστήριξης στα ελληνικά. 2-3 προτάσεις max. Τόνισε το πρόβλημα, τι έχει γίνει, και τι χρειάζεται.";
        userPrompt = ticketContext;
        break;
      case "triage":
        systemPrompt =
          "Είσαι triage AI. Επιστρέφεις μόνο JSON: {\"priority\":\"low|medium|high|critical\",\"suggested_status\":\"open|in_progress|resolved\",\"reason\":\"σύντομη αιτιολόγηση στα ελληνικά\",\"next_action\":\"τι πρέπει να κάνει ο agent\"}. Critical = ατύχημα/έκτακτο. High = πελάτης περιμένει/πληρωμή. Medium = app/όχημα. Low = ερώτηση.";
        userPrompt = ticketContext;
        break;
      case "custom":
        systemPrompt =
          "Είσαι βοηθός υποστήριξης. Απαντάς στα ελληνικά, σύντομα και πρακτικά.";
        userPrompt = `${ticketContext}\n\nΕρώτηση από τον agent: ${customPrompt || "Βοήθησέ με"}`;
        break;
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

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
      }),
    });

    if (aiResp.status === 429) {
      return new Response(
        JSON.stringify({ error: "Πολλά αιτήματα, προσπαθήστε ξανά σε λίγο." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (aiResp.status === 402) {
      return new Response(
        JSON.stringify({ error: "Δεν υπάρχουν διαθέσιμα credits AI." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ result: content, action }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("support-ai error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
