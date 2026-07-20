import { useState } from 'react';
import { Users, Copy, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function GroupOrderShare({ storeId }: { storeId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    if (!user) { toast.error('Συνδεθείτε πρώτα'); return; }
    const code = genCode();
    const { error } = await (supabase as any).from('group_orders').insert({
      host_id: user.id,
      store_id: storeId,
      share_code: code,
      closes_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    if (error) { toast.error('Αποτυχία'); return; }
    setShareCode(code);
  };

  const link = shareCode ? `${window.location.origin}/restaurant/${storeId}?group=${shareCode}` : '';

  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Σύνδεσμος αντιγράφηκε');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setShareCode(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="font-heading">
          <Users className="h-4 w-4 mr-1.5" />
          Ομαδική παραγγελία
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ομαδική Παραγγελία</DialogTitle>
        </DialogHeader>
        {!shareCode ? (
          <>
            <p className="text-sm text-muted-foreground">
              Καλέστε φίλους να προσθέσουν τα δικά τους προϊόντα στο ίδιο καλάθι. Όλοι πληρώνουν το μερίδιό τους στο ταμείο.
            </p>
            <Button onClick={start}>Ξεκίνησε ομαδική παραγγελία</Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Μοιραστείτε αυτόν τον σύνδεσμο:</p>
            <div className="bg-muted rounded-lg p-3 break-all text-xs font-mono">{link}</div>
            <div className="text-center">
              <span className="text-xs text-muted-foreground">Κωδικός: </span>
              <span className="text-2xl font-heading font-extrabold tracking-widest">{shareCode}</span>
            </div>
            <Button onClick={copy} className="w-full">
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {copied ? 'Αντιγράφηκε!' : 'Αντιγραφή συνδέσμου'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">Ισχύει για 30 λεπτά</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
