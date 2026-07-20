// Creates a Stripe Embedded Checkout session for a food-delivery order.
// The order row already exists (created client-side as `pending`).
// Stripe collects payment, and the `payments-webhook` flips it to `placed`
// which kicks off the existing dispatch flow.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CreateCheckoutBody {
  orderId: string;
  environment: StripeEnv;
  returnUrl: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Verify caller is logged in (we use the anon key + the caller's JWT to
    // enforce RLS — the user can only create checkout for orders they own).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError('Unauthorized', 401);
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) return jsonError('Unauthorized', 401);
    const userId = claims.claims.sub;

    const body = await req.json() as Partial<CreateCheckoutBody>;
    if (!body.orderId || !body.environment || !body.returnUrl) {
      return jsonError('Missing orderId, environment, or returnUrl', 400);
    }
    if (body.environment !== 'sandbox' && body.environment !== 'live') {
      return jsonError('Invalid environment', 400);
    }

    // Load the order through RLS — guarantees the caller owns it.
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, customer_id, store_id, total_amount, delivery_fee, tip_amount, status, payment_method')
      .eq('id', body.orderId)
      .maybeSingle();
    if (orderErr || !order) return jsonError('Order not found', 404);
    if (order.customer_id !== userId) return jsonError('Forbidden', 403);
    if (order.payment_method !== 'card') return jsonError('Order is not card-payment', 400);
    if (order.status !== 'pending') return jsonError('Order is no longer payable', 400);

    // Pull line items + store name for display in checkout
    const [{ data: items }, { data: store }, { data: profile }] = await Promise.all([
      supabase.from('order_items').select('name, quantity, unit_price').eq('order_id', order.id),
      supabase.from('stores').select('name').eq('id', order.store_id).maybeSingle(),
      supabase.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
    ]);

    const storeName = store?.name ?? 'Order';
    const lineItems: any[] = (items ?? []).map((it: any) => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: `${storeName} — ${it.name}`,
        },
        unit_amount: Math.round(Number(it.unit_price) * 100),
        // Greek standard food-VAT is 13%. Stripe's automatic_tax will correct
        // this if a different rate applies based on the buyer's location.
        tax_behavior: 'exclusive',
      },
      quantity: it.quantity ?? 1,
    }));

    if (Number(order.delivery_fee) > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Έξοδα παράδοσης' },
          unit_amount: Math.round(Number(order.delivery_fee) * 100),
          tax_behavior: 'exclusive',
        },
        quantity: 1,
      });
    }
    if (Number(order.tip_amount) > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Φιλοδώρημα οδηγού' },
          unit_amount: Math.round(Number(order.tip_amount) * 100),
          // Tips aren't taxable in most jurisdictions
          tax_behavior: 'exclusive',
        },
        quantity: 1,
      });
    }

    if (lineItems.length === 0) return jsonError('Order has no items', 400);

    const stripe = createStripeClient(body.environment);
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      ui_mode: 'embedded_page',
      return_url: body.returnUrl,
      customer_email: claims.claims.email,
      // Stripe calculates and collects the correct VAT for the buyer's
      // location (user picked "calculation only" mode at setup time).
      automatic_tax: { enabled: true },
      metadata: {
        orderId: order.id,
        userId,
        storeId: order.store_id,
        customerName: profile?.full_name ?? '',
      },
      payment_intent_data: {
        metadata: {
          orderId: order.id,
          userId,
        },
      },
    });

    return new Response(
      JSON.stringify({ clientSecret: session.client_secret }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('create-checkout error:', e);
    return jsonError(e instanceof Error ? e.message : 'Unknown error', 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
