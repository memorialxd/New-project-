// Tenor GIF search proxy. Uses TENOR_API_KEY if set, otherwise returns a
// curated trending list so the GIF picker still works without a key.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { rateLimit, rateLimitResponse, clientKey } from "../_shared/rate-limit.ts";
import { getAuthedUser, unauthorized } from "../_shared/auth.ts";

const FALLBACK = [
  'https://media.tenor.com/x8v1oNUOmg4AAAAi/thumbs-up-thumbs.gif',
  'https://media.tenor.com/I6kN-6X2K1IAAAAi/clapping.gif',
  'https://media.tenor.com/dn6r5BPRhMUAAAAi/fire-flame.gif',
  'https://media.tenor.com/0yzMK5B3-MIAAAAi/ok-okay.gif',
  'https://media.tenor.com/hNB3pkwa6OUAAAAi/heart-love.gif',
  'https://media.tenor.com/SbVMU_Z8NM0AAAAi/lol-laughing.gif',
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Require authentication to prevent quota drain / proxy abuse.
  const user = await getAuthedUser(req);
  if (!user) return unauthorized(corsHeaders);

  // Rate limit: 60 GIF searches/min per IP (burst 15)
  const rl = rateLimit(clientKey(req), { capacity: 15, refillPerMinute: 60 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter, corsHeaders);


  try {
    const { q = "", limit = 24 } = await req.json().catch(() => ({}));
    const key = Deno.env.get("TENOR_API_KEY");

    if (!key) {
      return new Response(JSON.stringify({ results: FALLBACK, fallback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      key,
      client_key: "lovable_chat",
      q: String(q || "trending"),
      limit: String(Math.min(Number(limit) || 24, 50)),
      media_filter: "tinygif,gif",
      contentfilter: "high",
    });

    const url = q
      ? `https://tenor.googleapis.com/v2/search?${params}`
      : `https://tenor.googleapis.com/v2/featured?${params}`;

    const r = await fetch(url);
    if (!r.ok) {
      return new Response(JSON.stringify({ results: FALLBACK, fallback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await r.json();
    const results: string[] = (json.results ?? [])
      .map((g: any) => g?.media_formats?.tinygif?.url ?? g?.media_formats?.gif?.url)
      .filter(Boolean);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ results: FALLBACK, fallback: true, error: String(e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
