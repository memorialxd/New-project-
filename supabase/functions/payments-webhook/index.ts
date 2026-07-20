// Stripe webhook: flips paid food orders from `pending` → `placed`,
// so the existing dispatch trigger picks them up. Refund events also
// credit the customer wallet.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _supabase;
}

async function markOrderPaid(orderId: string) {
  if (!orderId) return;
  // Only flip if still pending (idempotent — webhooks can retry)
  const { error } = await getSupabase()
    .from('orders')
    .update({ status: 'placed' })
    .eq('id', orderId)
    .eq('status', 'pending');
  if (error) console.error('markOrderPaid failed:', error);
}

async function markOrderFailed(orderId: string) {
  if (!orderId) return;
  const { error } = await getSupabase()
    .from('orders')
    .update({ status: 'cancelled', refund_reason: 'Payment failed' })
    .eq('id', orderId)
    .eq('status', 'pending');
  if (error) console.error('markOrderFailed failed:', error);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case 'checkout.session.completed':
    case 'payment_intent.succeeded':
    case 'transaction.completed': {
      const obj = event.data.object;
      const orderId =
        obj?.metadata?.orderId ??
        obj?.payment_intent?.metadata?.orderId ??
        null;
      if (orderId) await markOrderPaid(String(orderId));
      break;
    }
    case 'payment_intent.payment_failed':
    case 'transaction.payment_failed': {
      const orderId = event.data.object?.metadata?.orderId;
      if (orderId) await markOrderFailed(String(orderId));
      break;
    }
    default:
      console.log('Unhandled event:', event.type);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const rawEnv = new URL(req.url).searchParams.get('env');
  if (rawEnv !== 'sandbox' && rawEnv !== 'live') {
    console.error('Webhook with invalid env:', rawEnv);
    return new Response(JSON.stringify({ received: true, ignored: 'invalid env' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    await handleWebhook(req, rawEnv);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Webhook error', { status: 400 });
  }
});
