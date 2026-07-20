// Store Daily Summary — sends a daily digest log entry per active store.
// Designed to be invoked by a scheduled job (cron) once per day.
// Computes yesterday's order/revenue stats and writes a row to store_daily_summary_log.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getAuthedUser, hasCronSecret, unauthorized } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Restrict to cron (CRON_SECRET) or admin users.
  if (!hasCronSecret(req)) {
    const user = await getAuthedUser(req);
    if (!user?.isAdmin) return unauthorized(corsHeaders);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Yesterday window (UTC)
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const summaryDate = start.toISOString().slice(0, 10);

    // Active stores
    const { data: stores, error: sErr } = await supabase
      .from('stores')
      .select('id, name')
      .eq('is_active', true);
    if (sErr) throw sErr;

    let logged = 0;
    for (const store of stores ?? []) {
      // Skip if already logged
      const { data: existing } = await supabase
        .from('store_daily_summary_log')
        .select('id')
        .eq('store_id', store.id)
        .eq('summary_date', summaryDate)
        .maybeSingle();
      if (existing) continue;

      // Compute summary
      const { data: orders } = await supabase
        .from('orders')
        .select('id, status, total_amount, store_charge')
        .eq('store_id', store.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      const totals = (orders ?? []).reduce(
        (acc, o: any) => {
          acc.count += 1;
          acc.revenue += Number(o.total_amount ?? 0);
          acc.charge += Number(o.store_charge ?? 0);
          if (o.status === 'delivered') acc.delivered += 1;
          if (o.status === 'cancelled') acc.cancelled += 1;
          return acc;
        },
        { count: 0, delivered: 0, cancelled: 0, revenue: 0, charge: 0 },
      );

      // Insert log row
      await supabase.from('store_daily_summary_log').insert({
        store_id: store.id,
        summary_date: summaryDate,
      });

      console.log(`[summary] ${store.name}: ${JSON.stringify(totals)}`);
      logged += 1;
    }

    return new Response(
      JSON.stringify({ ok: true, date: summaryDate, stores_processed: logged }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('store-daily-summary error', e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
