import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Map as MapIcon, Loader2 } from 'lucide-react';

export default function DriverMapSettings() {
  const [loading, setLoading] = useState(true);
  const [showStores, setShowStores] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('platform_settings').select('show_stores_on_driver_map').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data) setShowStores(Boolean((data as { show_stores_on_driver_map?: boolean }).show_stores_on_driver_map ?? true));
        setLoading(false);
      });
  }, []);

  const handleToggle = async (value: boolean) => {
    setSaving(true);
    setShowStores(value);
    const { error } = await supabase
      .from('platform_settings')
      .update({ show_stores_on_driver_map: value } as never)
      .eq('id', 1);
    setSaving(false);
    if (error) {
      toast.error('Αποτυχία αποθήκευσης');
      setShowStores(!value);
    } else {
      toast.success(value ? 'Ενεργοποιήθηκε' : 'Απενεργοποιήθηκε');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-primary" />
          Ρυθμίσεις Χάρτη Οδηγών
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
          <div className="flex-1 min-w-0 pr-3">
            <Label className="font-heading text-sm font-semibold">Εμφάνιση καταστημάτων στον χάρτη</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Οι οδηγοί βλέπουν εικόνες των καταστημάτων στον χάρτη μαζί με τον αριθμό ενεργών παραγγελιών (placed/accepted/preparing/ready).
            </p>
          </div>
          {loading || saving
            ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            : <Switch checked={showStores} onCheckedChange={handleToggle} />}
        </div>
      </CardContent>
    </Card>
  );
}
