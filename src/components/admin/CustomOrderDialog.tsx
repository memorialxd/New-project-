import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilePlus2, ScanLine, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CustomOrderDialog() {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptText, setReceiptText] = useState('');

  const [storeId, setStoreId] = useState<string>('');
  const [total, setTotal] = useState('');
  const [feeOverride, setFeeOverride] = useState('');
  const [driverPayoutOverride, setDriverPayoutOverride] = useState('');
  const [storeChargeOverride, setStoreChargeOverride] = useState('');
  const [distance, setDistance] = useState('');
  const [address, setAddress] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [items, setItems] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');

  const { data: stores } = useQuery({
    queryKey: ['stores-for-custom-order'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const reset = () => {
    setReceiptText(''); setStoreId(''); setTotal(''); setFeeOverride('');
    setDriverPayoutOverride(''); setStoreChargeOverride('');
    setDistance(''); setAddress(''); setCustomerName(''); setCustomerPhone('');
    setItems(''); setNotes(''); setPaymentMethod('cash');
  };

  const scanReceipt = async () => {
    if (receiptText.trim().length < 5) {
      toast.error('Επικόλλησε κείμενο απόδειξης');
      return;
    }
    setScanning(true);
    const { data, error } = await supabase.functions.invoke('parse-receipt', {
      body: { text: receiptText },
    });
    setScanning(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const parsed = data as {
      total_amount?: number; delivery_address?: string;
      customer_name?: string; customer_phone?: string;
      items_summary?: string; notes?: string;
    };
    if (parsed.total_amount) setTotal(String(parsed.total_amount));
    if (parsed.delivery_address) setAddress(parsed.delivery_address);
    if (parsed.customer_name) setCustomerName(parsed.customer_name);
    if (parsed.customer_phone) setCustomerPhone(parsed.customer_phone);
    if (parsed.items_summary) setItems(parsed.items_summary);
    if (parsed.notes) setNotes(parsed.notes);
    toast.success('Συμπληρώθηκε από απόδειξη');
  };

  const submit = async () => {
    if (!storeId) { toast.error('Διάλεξε κατάστημα'); return; }
    if (!total || Number(total) < 0) { toast.error('Σύνολο παραγγελίας;'); return; }
    if (!address.trim()) { toast.error('Διεύθυνση παράδοσης;'); return; }

    setSubmitting(true);
    const { data, error } = await (supabase as any).rpc('create_custom_order', {
      p_store_id: storeId,
      p_total_amount: Number(total),
      p_delivery_address: address,
      p_distance_km: distance ? Number(distance) : null,
      p_customer_name: customerName || null,
      p_customer_phone: customerPhone || null,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
      p_items_summary: items || null,
      p_delivery_fee_override: feeOverride ? Number(feeOverride) : null,
      p_driver_payout_override: driverPayoutOverride ? Number(driverPayoutOverride) : null,
      p_store_charge_override: storeChargeOverride ? Number(storeChargeOverride) : null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Παραγγελία δημιουργήθηκε');
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <FilePlus2 className="h-3.5 w-3.5" />
          Custom Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Νέα παραγγελία (manual / scan)</DialogTitle>
          <DialogDescription>
            Επικόλλησε απόδειξη ή συμπλήρωσε τα στοιχεία. Το delivery fee υπολογίζεται από τα χιλιόμετρα.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Επικόλληση απόδειξης (auto-fill)</Label>
            <Textarea
              value={receiptText}
              onChange={(e) => setReceiptText(e.target.value)}
              rows={3}
              placeholder="Επικόλλησε κείμενο απόδειξης από efood/wolt/box…"
            />
            <Button size="sm" variant="secondary" className="mt-2 gap-2" onClick={scanReceipt} disabled={scanning}>
              {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanLine className="h-3 w-3" />}
              {scanning ? 'Σάρωση…' : 'Σάρωση & συμπλήρωση'}
            </Button>
          </div>

          <div>
            <Label className="text-xs">Κατάστημα</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger><SelectValue placeholder="Διάλεξε κατάστημα" /></SelectTrigger>
              <SelectContent>
                {stores?.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Σύνολο παραγγελίας (€)</Label>
              <Input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Τρόπος πληρωμής</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Μετρητά</SelectItem>
                  <SelectItem value="card">Κάρτα</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Απόσταση (km)</Label>
              <Input type="number" step="0.1" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="π.χ. 2.5" />
            </div>
            <div>
              <Label className="text-xs">Delivery fee (override)</Label>
              <Input type="number" step="0.01" value={feeOverride} onChange={(e) => setFeeOverride(e.target.value)} placeholder="auto" />
            </div>
          </div>

          <details className="rounded-lg border bg-muted/40 px-3 py-2">
            <summary className="text-xs font-heading font-semibold cursor-pointer">Παράκαμψη πληρωμών (προαιρετικό)</summary>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div>
                <Label className="text-xs">Πληρωμή Οδηγού (€)</Label>
                <Input type="number" step="0.01" min="0" max="50" value={driverPayoutOverride} onChange={(e) => setDriverPayoutOverride(e.target.value)} placeholder="auto" />
                <p className="text-[10px] text-muted-foreground mt-0.5">0–50€ · Αυτό που θα πάρει ο οδηγός.</p>
              </div>
              <div>
                <Label className="text-xs">Χρέωση Καταστήματος (€)</Label>
                <Input type="number" step="0.01" min="0" max="1000" value={storeChargeOverride} onChange={(e) => setStoreChargeOverride(e.target.value)} placeholder="auto" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Επιπλέον χρέωση πέρα από το 15% commission.</p>
              </div>
            </div>
          </details>

          <div>
            <Label className="text-xs">Διεύθυνση παράδοσης</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Όνομα πελάτη</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Τηλέφωνο</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Προϊόντα (περίληψη)</Label>
            <Input value={items} onChange={(e) => setItems(e.target.value)} placeholder="2x Πίτσα, 1 Coke…" />
          </div>

          <div>
            <Label className="text-xs">Σημειώσεις</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Άκυρο</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Δημιουργία…' : 'Δημιουργία παραγγελίας'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
