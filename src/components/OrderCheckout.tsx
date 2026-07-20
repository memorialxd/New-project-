import { useEffect, useState } from 'react';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { getStripe, getStripeEnvironment } from '@/lib/stripe';
import { supabase } from '@/integrations/supabase/client';

interface OrderCheckoutProps {
  orderId: string;
  /** Path within the app to send the customer to after payment, e.g. `/order-tracking/<id>` */
  returnPath: string;
  onError?: (msg: string) => void;
}

/**
 * Embedded Stripe checkout for a food-delivery order. The order must
 * already exist in `orders` with status='pending', payment_method='card'.
 * On payment success, the webhook flips it to 'placed' (which kicks off
 * dispatch) and Stripe navigates the user to `returnPath`.
 */
export function OrderCheckout({ orderId, returnPath, onError }: OrderCheckoutProps) {
  const [error, setError] = useState<string | null>(null);

  const fetchClientSecret = async (): Promise<string> => {
    const returnUrl = `${window.location.origin}${returnPath}?session_id={CHECKOUT_SESSION_ID}`;
    const { data, error: fnError } = await supabase.functions.invoke('create-checkout', {
      body: { orderId, environment: getStripeEnvironment(), returnUrl },
    });
    if (fnError || !data?.clientSecret) {
      const msg = fnError?.message || data?.error || 'Αποτυχία δημιουργίας πληρωμής';
      setError(msg);
      onError?.(msg);
      throw new Error(msg);
    }
    return data.clientSecret;
  };

  useEffect(() => () => setError(null), []);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div id="checkout" className="min-h-[420px]">
      <div className="flex items-center justify-center py-10 text-muted-foreground absolute pointer-events-none">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Φόρτωση ασφαλούς πληρωμής...
      </div>
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
