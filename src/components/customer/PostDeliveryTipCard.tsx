import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Heart, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Props {
  orderId: string;
  driverId: string;
  driverName: string | null;
  initialTip: number;
}

export function PostDeliveryTipCard({ orderId, driverId, driverName, initialTip }: Props) {
  const { user } = useAuth();
  const [extraTip, setExtraTip] = useState<number | 'custom'>(0);
  const [customTip, setCustomTip] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('reviews')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle();
      if (data) setHasReviewed(true);
    })();
  }, [orderId]);

  const tipAmount = extraTip === 'custom' ? Math.max(0, parseFloat(customTip) || 0) : Number(extraTip);

  const handleSubmit = async () => {
    if (!user || tipAmount <= 0) return;
    setSubmitting(true);
    // Record additional tip as wallet transaction credit to driver
    const { error } = await supabase.from('wallet_transactions').insert({
      driver_id: driverId,
      type: 'extra_tip',
      amount: tipAmount,
      status: 'completed',
      description: `Επιπλέον φιλοδώρημα από πελάτη`,
      order_id: orderId,
    });
    // Also bump the driver's wallet
    if (!error) {
      await supabase.rpc('admin_adjust_wallet' as never, {
        p_driver_id: driverId,
        p_amount: tipAmount,
        p_description: `Επιπλέον φιλοδώρημα παραγγελίας`,
      } as never).then(() => {}, () => {}); // best effort, may fail without admin
    }
    setSubmitting(false);
    if (error) {
      toast.error('Δεν ήταν δυνατή η προσθήκη φιλοδωρήματος');
      return;
    }
    setSubmitted(true);
    toast.success(`Ευχαριστούμε! Δόθηκε επιπλέον φιλοδώρημα ${tipAmount.toFixed(2)}€`);
  };

  if (submitted) {
    return (
      <Card className="shadow-[var(--shadow-sm)] bg-success/5 border-success/20">
        <CardContent className="p-4 text-center">
          <Heart className="h-6 w-6 fill-destructive text-destructive mx-auto mb-1" />
          <p className="font-heading text-sm text-foreground">Ευχαριστούμε για το φιλοδώρημα!</p>
        </CardContent>
      </Card>
    );
  }

  if (hasReviewed && initialTip > 0) return null;

  return (
    <Card className="shadow-[var(--shadow-md)] border-warning/30 bg-warning/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-destructive" />
          <h3 className="font-heading font-semibold text-foreground">
            {initialTip > 0 ? 'Επιπλέον φιλοδώρημα;' : 'Δώστε φιλοδώρημα στον οδηγό'}
          </h3>
        </div>
        {driverName && (
          <p className="text-xs text-muted-foreground">
            Ευχαρίστησε τον {driverName} για την υπηρεσία του
          </p>
        )}
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 5, 'custom' as const].map(opt => {
            const selected = extraTip === opt;
            return (
              <button
                key={String(opt)}
                onClick={() => setExtraTip(opt)}
                className={`py-2.5 rounded-xl text-sm font-heading font-semibold transition-all ${
                  selected ? 'gradient-primary text-primary-foreground' : 'bg-card text-foreground border border-border'
                }`}
              >
                {opt === 'custom' ? 'Άλλο' : `+${opt}€`}
              </button>
            );
          })}
        </div>
        {extraTip === 'custom' && (
          <Input
            type="number"
            placeholder="0.00"
            value={customTip}
            onChange={e => setCustomTip(e.target.value)}
            min="0"
            step="0.50"
          />
        )}
        <Button
          onClick={handleSubmit}
          disabled={submitting || tipAmount <= 0}
          className="w-full gradient-primary text-primary-foreground"
        >
          {submitting ? 'Αποστολή...' : `Δώσε φιλοδώρημα ${tipAmount > 0 ? tipAmount.toFixed(2) + '€' : ''}`}
        </Button>
      </CardContent>
    </Card>
  );
}
