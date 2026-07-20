import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function AutoAcceptRules({ storeId }: { storeId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [maxAmount, setMaxAmount] = useState('25');
  const [prep, setPrep] = useState('20');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('store_auto_accept_rules').select('*').eq('store_id', storeId).maybeSingle();
      if (data) {
        setEnabled(data.enabled);
        setMaxAmount(String(data.max_amount));
        setPrep(String(data.default_prep_minutes));
      }
      setLoading(false);
    })();
  }, [storeId]);

  const save = async () => {
    const { error } = await (supabase as any).from('store_auto_accept_rules').upsert({
      store_id: storeId,
      enabled,
      max_amount: Number(maxAmount) || 25,
      default_prep_minutes: Number(prep) || 20,
    });
    if (error) toast.error('Αποτυχία αποθήκευσης');
    else toast.success('Αποθηκεύτηκε');
  };

  if (loading) return null;

  return (
    <Card className="shadow-[var(--shadow-md)]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-heading font-bold text-foreground">Αυτόματη Αποδοχή</h3>
              <p className="text-xs text-muted-foreground">Δέξου αυτόματα μικρές παραγγελίες</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2">
          <Label className="font-heading text-xs">Μέγιστο ποσό (€)</Label>
          <Input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} disabled={!enabled} />
        </div>

        <div className="space-y-2">
          <Label className="font-heading text-xs">Προεπιλεγμένος χρόνος ετοιμασίας (λεπτά)</Label>
          <Input type="number" value={prep} onChange={e => setPrep(e.target.value)} disabled={!enabled} />
        </div>

        <Button onClick={save} className="w-full">Αποθήκευση</Button>
      </CardContent>
    </Card>
  );
}
