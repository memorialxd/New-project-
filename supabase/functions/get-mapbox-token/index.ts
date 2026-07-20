import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getAuthedUser, unauthorized } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require an authenticated app user — Mapbox quota should not be drained by anonymous bots.
  const user = await getAuthedUser(req);
  if (!user) return unauthorized(corsHeaders);

  const token = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "MAPBOX_PUBLIC_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
