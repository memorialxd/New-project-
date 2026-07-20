// Google Geocoding proxy — keeps the API key server-side.
// POST { q: <address> }  → { result: { latitude, longitude, formatted } | null }
// Requires an authenticated app user to prevent quota abuse.

import { getAuthedUser, unauthorized } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthedUser(req);
  if (!user) return unauthorized(corsHeaders);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Accept both POST body { q } and legacy ?q= for compatibility.
  let q = "";
  const url = new URL(req.url);
  q = (url.searchParams.get("q") ?? "").trim();
  if (!q && req.method === "POST") {
    try {
      const body = await req.json();
      q = String(body?.q ?? "").trim();
    } catch { /* ignore */ }
  }
  if (!q || q.length > 300) {
    return new Response(JSON.stringify({ error: "missing or invalid q" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const bounds = "39.55,20.70|39.78,21.00";
    const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=gr&language=el&components=country:GR&bounds=${encodeURIComponent(bounds)}&key=${key}`;
    const res = await fetch(gUrl);
    const json = await res.json();
    const r = json?.results?.[0];
    if (!r?.geometry?.location) {
      return new Response(JSON.stringify({ result: null, status: json?.status ?? "ZERO_RESULTS" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { lat, lng } = r.geometry.location;
    return new Response(JSON.stringify({
      result: { latitude: lat, longitude: lng, formatted: r.formatted_address ?? q },
      status: "OK",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
