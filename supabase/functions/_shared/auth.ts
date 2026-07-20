// Shared auth helpers for edge functions.
// Most Lovable-managed functions deploy with verify_jwt = false, so we validate
// the caller's JWT explicitly here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AuthedUser {
  id: string;
  email: string | null;
  isAdmin: boolean;
  isSupport: boolean;
  isStore: boolean;
  isDriver: boolean;
}

/**
 * Verify the bearer JWT in the request. Returns the user + role flags, or null
 * if the token is missing/invalid.
 */
export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) return null;
  const userId = userData.user.id;
  const email = userData.user.email ?? null;

  // Fetch role flags from user_roles using service role (bypass RLS).
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roleSet = new Set((roles ?? []).map((r: any) => r.role));
  return {
    id: userId,
    email,
    isAdmin: roleSet.has("admin"),
    isSupport: roleSet.has("support"),
    isStore: roleSet.has("store"),
    isDriver: roleSet.has("driver"),
  };
}

/**
 * Check whether the request carries a valid CRON_SECRET in either:
 *  - Authorization: Bearer <CRON_SECRET>
 *  - X-Cron-Secret: <CRON_SECRET>
 *
 * Returns false if CRON_SECRET env var is not configured.
 */
export function hasCronSecret(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return false;
  const x = req.headers.get("X-Cron-Secret");
  if (x && x === expected) return true;
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7).trim() === expected) return true;
  return false;
}

export function unauthorized(corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
