import { useEffect, useState } from 'react';
import { Printer, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getPrinterPrefs, setPrinterPrefs, type PrinterPrefs } from '@/lib/printer-prefs';
import { printOrderTicket } from './PrintOrderTicket';

interface PrinterSettingsProps {
  storeName: string;
}

export function PrinterSettings({ storeName }: PrinterSettingsProps) {
  const [prefs, setPrefs] = useState<PrinterPrefs>(getPrinterPrefs());

  useEffect(() => {
    const handler = (e: Event) => setPrefs((e as CustomEvent<PrinterPrefs>).detail);
    window.addEventListener('printer-prefs-changed', handler);
    return () => window.removeEventListener('printer-prefs-changed', handler);
  }, []);

  const update = (patch: Partial<PrinterPrefs>) => {
    setPrinterPrefs(patch);
    setPrefs(prev => ({ ...prev, ...patch }));
  };

  const testPrint = () => {
    printOrderTicket(
      {
        id: 'test-0001-test',
        created_at: new Date().toISOString(),
        total_amount: 12.5,
        delivery_fee: 2.0,
        tip_amount: 1.0,
        notes: 'Δοκιμαστική εκτύπωση',
        delivery_address: 'Δοκιμή 123, Αθήνα',
        order_items: [
          { name: 'Δοκιμαστικό Προϊόν', quantity: 1, unit_price: 9.5 },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      storeName,
    );
    toast.success('Εστάλη δοκιμαστική εκτύπωση');
  };

  return (
    <Card className="shadow-[var(--shadow-md)]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-heading font-bold text-foreground">Εκτυπωτής</h3>
            <p className="text-xs text-muted-foreground">
              Ρυθμίσεις εκτύπωσης δελτίων παραγγελίας (αποθηκεύονται σε αυτή τη συσκευή)
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="font-heading font-semibold text-sm text-foreground">Ενεργοποίηση εκτυπωτή</p>
            <p className="text-xs text-muted-foreground">Ενεργοποίηση κουμπιών εκτύπωσης</p>
          </div>
          <Switch checked={prefs.enabled} onCheckedChange={(v) => update({ enabled: v })} />
        </div>

        <div className={`flex items-center justify-between rounded-lg border p-3 ${prefs.autoPrintOnAccept ? 'border-warning/40 bg-warning/5' : 'border-border'}`}>
          <div className="flex items-center gap-2">
            <Zap className={`h-4 w-4 ${prefs.autoPrintOnAccept ? 'text-warning' : 'text-muted-foreground'}`} />
            <div>
              <p className="font-heading font-semibold text-sm text-foreground">Αυτόματη εκτύπωση</p>
              <p className="text-xs text-muted-foreground">Αυτόματη εκτύπωση όταν η παραγγελία γίνει αποδεκτή</p>
            </div>
          </div>
          <Switch
            checked={prefs.autoPrintOnAccept}
            disabled={!prefs.enabled}
            onCheckedChange={(v) => update({ autoPrintOnAccept: v })}
          />
        </div>

        <div className="space-y-2">
          <Label className="font-heading text-xs">Όνομα εκτυπωτή (προαιρετικό)</Label>
          <Input
            value={prefs.printerName}
            onChange={(e) => update({ printerName: e.target.value })}
            placeholder="π.χ. Κουζίνα — Star TSP100"
            disabled={!prefs.enabled}
          />
          <p className="text-xs text-muted-foreground">
            Ο πραγματικός εκτυπωτής επιλέγεται από το διάλογο εκτύπωσης του προγράμματος περιήγησης.
            Συμβουλή: στις ρυθμίσεις του εκτυπωτή ενεργοποιήστε τη "σιωπηλή εκτύπωση" για άμεση εκτύπωση χωρίς διάλογο.
          </p>
        </div>

        <Button onClick={testPrint} variant="outline" className="w-full" disabled={!prefs.enabled}>
          <Printer className="h-4 w-4 mr-2" />
          Δοκιμαστική εκτύπωση
        </Button>
      </CardContent>
    </Card>
  );
}
