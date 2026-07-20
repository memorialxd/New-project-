import { useState, useEffect } from 'react';
import { Users, Copy, Gift, CheckCircle2, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

export function DriverReferral() {
  const { user } = useAuth();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('driver_referrals')
        .select('*')
        .eq('referrer_id', user.id)
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        setReferralCode(data[0].referral_code);
        setReferrals(data);
      } else {
        const code = `GRID-${user.id.slice(0, 6).toUpperCase()}`;
        const { data: newRef } = await supabase
          .from('driver_referrals')
          .insert({ referrer_id: user.id, referral_code: code })
          .select()
          .single();
        if (newRef) {
          setReferralCode(newRef.referral_code);
          setReferrals([newRef]);
        }
      }
      setLoading(false);
    };
    fetch();
  }, [user]);

  const copyCode = () => {
    if (referralCode) {
      navigator.clipboard.writeText(referralCode);
      toast({ title: 'Αντιγράφηκε!', description: 'Κωδικός στο πρόχειρο' });
    }
  };

  const shareCode = () => {
    if (referralCode && navigator.share) {
      navigator.share({
        title: 'Fresh Delivery Driver',
        text: `Γίνε οδηγός Fresh Delivery! Χρησιμοποίησε τον κωδικό μου: ${referralCode}`,
      });
    } else {
      copyCode();
    }
  };

  const completedReferrals = referrals.filter(r => r.status === 'completed').length;
  const totalBonus = completedReferrals * 10;

  if (loading) return null;

  return (
    <div className="space-y-4">
      {/* Hero card */}
      <div className="rounded-2xl driver-gradient-earn p-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-white/15 flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
          <Gift className="h-8 w-8 text-white" />
        </div>
        <h3 className="font-heading font-bold text-xl text-white">Κάλεσε & Κέρδισε</h3>
        <p className="text-xs text-white/60 mt-1 max-w-[240px] mx-auto">
          10€ μπόνους για κάθε οδηγό που εγγράφεται με τον κωδικό σου
        </p>

        <div className="mt-4 rounded-xl bg-white/10 backdrop-blur-sm p-3 flex items-center justify-between border border-white/10">
          <span className="font-mono font-bold text-lg tracking-wider text-white">{referralCode}</span>
          <div className="flex gap-2">
            <button
              onClick={copyCode}
              className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors"
            >
              <Copy className="h-4 w-4 text-white" />
            </button>
            <button
              onClick={shareCode}
              className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors"
            >
              <Share2 className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl driver-glass p-4 text-center">
          <Users className="h-5 w-5 text-[hsl(var(--driver-text-muted))] mx-auto mb-1.5" />
          <p className="text-[9px] text-[hsl(var(--driver-text-muted))] uppercase tracking-wider">Προσκλήσεις</p>
          <p className="font-heading font-bold text-xl text-[hsl(var(--driver-text))] tabular-nums">{referrals.length}</p>
        </div>
        <div className="rounded-xl driver-glass p-4 text-center">
          <CheckCircle2 className="h-5 w-5 text-[hsl(var(--driver-accent))] mx-auto mb-1.5" />
          <p className="text-[9px] text-[hsl(var(--driver-text-muted))] uppercase tracking-wider">Κερδίσατε</p>
          <p className="font-heading font-bold text-xl text-[hsl(var(--driver-accent))] tabular-nums">{totalBonus}€</p>
        </div>
      </div>
    </div>
  );
}
