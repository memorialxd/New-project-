import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Gift, Copy, Share2, Check } from 'lucide-react';
import { useCustomerReferral } from '@/hooks/useCustomerReferral';
import { toast } from 'sonner';

export function CustomerReferralCard() {
  const { code, referrals, loading } = useCustomerReferral();
  const [copied, setCopied] = useState(false);

  if (loading || !code) return null;

  const completed = referrals.filter(r => r.status === 'completed').length;
  const earned = referrals
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + Number(r.reward_amount), 0);

  const shareUrl = `${window.location.origin}/auth?ref=${code}`;
  const shareText = `Δοκίμασε την εφαρμογή και πάρε 5€ έκπτωση! Κωδικός: ${code}`;

  const copy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success('Σύνδεσμος αντιγράφηκε');
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Δοκίμασέ μας!', text: shareText, url: shareUrl });
      } catch {
        copy();
      }
    } else {
      copy();
    }
  };

  return (
    <Card className="shadow-[var(--shadow-md)] border-success/20 bg-gradient-to-br from-success/5 to-transparent">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-success" />
          <span className="font-heading font-semibold text-foreground">Πρόσκληση φίλων</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Πάρε 5€ για κάθε φίλο που κάνει την πρώτη του παραγγελία
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-muted rounded-lg px-3 py-2 font-mono text-sm font-bold text-foreground tracking-wider text-center">
            {code}
          </div>
          <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={share} className="shrink-0">
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
        {completed > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
            <span className="text-muted-foreground">{completed} επιτυχημένες προσκλήσεις</span>
            <span className="font-heading font-bold text-success">+{earned.toFixed(2)}€</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
