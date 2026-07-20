// Generates a hero-card image via Lovable AI Gateway and returns base64.
// Body: { prompt: string, title?: string, source_image_url?: string }
// Returns: { b64_json: string }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    // AuthZ — admin only
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user?.id) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: u.user.id, _role: "admin",
    });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const { prompt, title, source_image_url } = body as {
      prompt: string; title?: string; source_image_url?: string;
    };
    if (!prompt || typeof prompt !== "string") return json({ error: "prompt required" }, 400);

    const fullPrompt = [
      "Premium food-delivery hero promo banner, editorial photography style.",
      title ? `Theme: "${title}".` : "",
      source_image_url ? `Visual reference: ${source_image_url}` : "",
      `Creative direction: ${prompt}.`,
      "Square layout, vibrant appetite-appealing colors, soft natural lighting,",
      "clear negative space for headline, no embedded text, no watermark.",
    ].filter(Boolean).join(" ");

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt: fullPrompt,
        quality: "low",
        size: "1024x1024",
        n: 1,
        stream: false,
      }),
    });

    if (upstream.status === 429) return json({ error: "Rate limited" }, 429);
    if (upstream.status === 402) return json({ error: "AI credits exhausted" }, 402);
    if (!upstream.ok) {
      const detail = await upstream.text();
      return json({ error: "Gateway error", detail }, upstream.status);
    }
    const data = await upstream.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return json({ error: "No image returned" }, 502);

    return json({ b64_json: b64 });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
