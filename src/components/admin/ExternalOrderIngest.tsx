import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Send, Sparkles, ScanLine, FileText, AlertCircle, TrendingUp } from 'lucide-react';

type Source = 'manual' | 'efood' | 'wolt' | 'box' | 'other';

interface StoreOption {
  id: string;
  name: string;
  ext_billing_mode: string;
  ext_commission_pct: number;
  ext_flat_fee: number;
  ext_margin_pct: number;
}

interface FormState {
  store_id: string;
  source: Source;
  total_amount: string;
  delivery_address: string;
  distance_km: string;
  customer_name: string;
  customer_phone: string;
  notes: string;
  external_ref: string;
  items_summary: string;
  driver_payout_override: string;
  store_charge_override: string;
}

const blankForm: FormState = {
  store_id: '',
  source: 'manual',
  total_amount: '',
  delivery_address: '',
  distance_km: '',
  customer_name: '',
  customer_phone: '',
  notes: '',
  external_ref: '',
  items_summary: '',
  driver_payout_override: '',
  store_charge_override: '',
};

export default function ExternalOrderIngest() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [form, setForm] = useState<FormState>(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [scanText, setScanText] = useState('');

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, ext_billing_mode, ext_commission_pct, ext_flat_fee, ext_margin_pct' as any)
      .order('name')
      .then(({ data }) => {
        if (data) setStores(data as unknown as StoreOption[]);
      });
  }, []);

  const selectedStore = stores.find(s => s.id === form.store_id);
  const totalAmount = Number(form.total_amount) || 0;
  const distanceKm = Number(form.distance_km) || 0;

  // Live preview of money flow
  const preview = useMemo(() => {
    if (!selectedStore) return null;
    const baseDriverPay = Math.max(3, 3 + 0.5 * distanceKm); // matches platform defaults
    const driverPay = form.driver_payout_override
      ? Number(form.driver_payout_override)
      : baseDriverPay;

    let storeCharge: number;
    if (form.store_charge_override) {
      storeCharge = Number(form.store_charge_override);
    } else {
      switch (selectedStore.ext_billing_mode) {
        case 'commission':
          storeCharge = +(totalAmount * selectedStore.ext_commission_pct / 100).toFixed(2);
          break;
        case 'flat_fee':
          storeCharge = +Number(selectedStore.ext_flat_fee).toFixed(2);
          break;
        case 'driver_plus_margin':
          storeCharge = +(driverPay * (1 + selectedStore.ext_margin_pct / 100)).toFixed(2);
          break;
        default:
          storeCharge = +(totalAmount * 0.15).toFixed(2);
      }
    }
    return {
      driverPay: +driverPay.toFixed(2),
      storeCharge: +storeCharge.toFixed(2),
      profit: +(storeCharge - driverPay).toFixed(2),
    };
  }, [selectedStore, totalAmount, distanceKm, form.driver_payout_override, form.store_charge_override]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(p => ({ ...p, [k]: v }));

  const handleParse = async () => {
    if (!pasteText.trim()) {
      toast.error('Επικόλλησε κείμενο πρώτα');
      return;
    }
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-receipt', {
        body: { text: pasteText },
      });
      if (error) throw error;
      const d = data?.data ?? {};
      setForm(p => ({
        ...p,
        source: (d.source as Source) || 'other',
        total_amount: d.total_amount != null ? String(d.total_amount) : p.total_amount,
        delivery_address: d.delivery_address || p.delivery_address,
        customer_name: d.customer_name || p.customer_name,
        customer_phone: d.customer_phone || p.customer_phone,
        items_summary: d.items_summary || p.items_summary,
        external_ref: d.external_ref || p.external_ref,
        notes: d.notes || p.notes,
      }));
      toast.success('Στοιχεία εξήχθησαν — έλεγξε και υποβάλε');
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία ανάλυσης');
    } finally {
      setParsing(false);
    }
  };

  const handleScanFill = () => {
    // QR-style codes from receipts often encode JSON or url-style key=value
    const txt = scanText.trim();
    if (!txt) return toast.error('Σκάναρε ή επικόλλησε τον κωδικό');
    try {
      const parsed = JSON.parse(txt);
      setForm(p => ({
        ...p,
        source: parsed.source || 'other',
        total_amount: parsed.total != null ? String(parsed.total) : p.total_amount,
        delivery_address: parsed.address || p.delivery_address,
        customer_phone: parsed.phone || p.customer_phone,
        external_ref: parsed.ref || p.external_ref,
        items_summary: parsed.items || p.items_summary,
      }));
      toast.success('QR αναγνωρίστηκε');
    } catch {
      // fall back to using the raw text as external_ref
      update('external_ref', txt);
      toast.success('Κωδικός καταγράφηκε ως external ref');
    }
  };

  const handleSubmit = async () => {
    if (!form.store_id) return toast.error('Επίλεξε κατάστημα');
    if (!form.total_amount || Number(form.total_amount) <= 0) return toast.error('Συμπλήρωσε σύνολο');
    if (!form.delivery_address.trim()) return toast.error('Συμπλήρωσε διεύθυνση');

    setSubmitting(true);
    const { error } = await supabase.rpc('create_external_order' as any, {
      p_store_id: form.store_id,
      p_source: form.source,
      p_total_amount: Number(form.total_amount),
      p_delivery_address: form.delivery_address,
      p_distance_km: form.distance_km ? Number(form.distance_km) : null,
      p_customer_name: form.customer_name || null,
      p_customer_phone: form.customer_phone || null,
      p_notes: form.notes || null,
      p_external_ref: form.external_ref || null,
      p_driver_payout_override: form.driver_payout_override ? Number(form.driver_payout_override) : null,
      p_store_charge_override: form.store_charge_override ? Number(form.store_charge_override) : null,
      p_items_summary: form.items_summary || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Παραγγελία δημιουργήθηκε & εστάλη στους οδηγούς');
      setForm(blankForm);
      setPasteText('');
      setScanText('');
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h2 className="font-heading font-bold text-xl">Εισαγωγή Εξωτερικών Παραγγελιών</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Δημιούργησε χειροκίνητα ή από eFood / Wolt / Box και στείλε τα στους οδηγούς.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr,340px] gap-4">
        {/* LEFT: ingestion */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base">Πηγή Παραγγελίας</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="manual">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="manual" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Χειροκίνητα</TabsTrigger>
                <TabsTrigger value="paste" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />Επικόλληση + AI</TabsTrigger>
                <TabsTrigger value="scan" className="gap-1.5"><ScanLine className="h-3.5 w-3.5" />Σκανάρισμα QR</TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="mt-4">
                <p className="text-xs text-muted-foreground">Συμπλήρωσε τα πεδία παρακάτω.</p>
              </TabsContent>

              <TabsContent value="paste" className="mt-4 space-y-3">
                <Label className="text-sm">Επικόλλησε email/SMS/κείμενο από eFood / Wolt / Box</Label>
                <Textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder={`π.χ.\nΝέα παραγγελία efood #A12345\nΣύνολο: 18.40€\nΔιεύθυνση: Ερμού 12, Αθήνα\nΓιάννης 6912345678\n2x Πίτσα Μαργαρίτα, 1x Κόκα Κόλα`}
                  rows={6}
                  className="text-xs font-mono"
                />
                <Button onClick={handleParse} disabled={parsing} className="w-full gap-2">
                  {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Ανάλυση με AI
                </Button>
              </TabsContent>

              <TabsContent value="scan" className="mt-4 space-y-3">
                <Label className="text-sm">Σκανάρισε ή επικόλλησε QR / barcode</Label>
                <Input
                  value={scanText}
                  onChange={e => setScanText(e.target.value)}
                  placeholder='π.χ. {"source":"efood","total":18.4,"address":"Ερμού 12"} ή απλό ref'
                  className="text-xs font-mono"
                />
                <Button onClick={handleScanFill} variant="outline" className="w-full gap-2">
                  <ScanLine className="h-4 w-4" /> Συμπλήρωση από κωδικό
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Tip: Αν το κατάστημα τυπώνει JSON QR, αυτόματα προσυμπληρώνεται. Αλλιώς ο κωδικός αποθηκεύεται ως external ref.
                </p>
              </TabsContent>
            </Tabs>

            {/* Form fields shared by all tabs */}
            <div className="space-y-3 mt-5 pt-5 border-t">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Κατάστημα *</Label>
                  <Select value={form.store_id} onValueChange={v => update('store_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Επίλεξε κατάστημα" /></SelectTrigger>
                    <SelectContent>
                      {stores.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Πηγή *</Label>
                  <Select value={form.source} onValueChange={v => update('source', v as Source)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Χειροκίνητη</SelectItem>
                      <SelectItem value="efood">eFood</SelectItem>
                      <SelectItem value="wolt">Wolt</SelectItem>
                      <SelectItem value="box">Box</SelectItem>
                      <SelectItem value="other">Άλλη</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Σύνολο (€) *</Label>
                  <Input type="number" step="0.01" min="0" value={form.total_amount} onChange={e => update('total_amount', e.target.value)} placeholder="18.40" />
                </div>
                <div>
                  <Label className="text-xs">Απόσταση (km)</Label>
                  <Input type="number" step="0.1" min="0" value={form.distance_km} onChange={e => update('distance_km', e.target.value)} placeholder="3.2" />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Διεύθυνση Παράδοσης *</Label>
                  <Input value={form.delivery_address} onChange={e => update('delivery_address', e.target.value)} placeholder="Ερμού 12, Αθήνα" />
                </div>
                <div>
                  <Label className="text-xs">Όνομα πελάτη</Label>
                  <Input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Τηλέφωνο πελάτη</Label>
                  <Input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} placeholder="6912345678" />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Σύνοψη προϊόντων</Label>
                  <Input value={form.items_summary} onChange={e => update('items_summary', e.target.value)} placeholder="2x Πίτσα Μαργαρίτα, 1x Κόκα Κόλα" />
                </div>
                <div>
                  <Label className="text-xs">External Ref</Label>
                  <Input value={form.external_ref} onChange={e => update('external_ref', e.target.value)} placeholder="A12345" />
                </div>
                <div>
                  <Label className="text-xs">Σημειώσεις</Label>
                  <Input value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Χωρίς κρεμμύδι" />
                </div>
              </div>

              <details className="rounded-lg border bg-muted/40 px-3 py-2">
                <summary className="text-xs font-heading font-semibold cursor-pointer">Παράκαμψη τιμών (προαιρετικό)</summary>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Label className="text-xs">Πληρωμή Οδηγού (€)</Label>
                    <Input type="number" step="0.01" value={form.driver_payout_override} onChange={e => update('driver_payout_override', e.target.value)} placeholder="auto" />
                  </div>
                  <div>
                    <Label className="text-xs">Χρέωση Καταστήματος (€)</Label>
                    <Input type="number" step="0.01" value={form.store_charge_override} onChange={e => update('store_charge_override', e.target.value)} placeholder="auto" />
                  </div>
                </div>
              </details>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: live money preview */}
        <div className="space-y-3">
          <Card className="sticky top-20">
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Ροή Χρημάτων
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedStore ? (
                <p className="text-xs text-muted-foreground">Επίλεξε κατάστημα για προεπισκόπηση.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Μοντέλο χρέωσης</span>
                    <Badge variant="outline" className="font-heading text-[10px]">
                      {selectedStore.ext_billing_mode === 'commission' && `Προμήθεια ${selectedStore.ext_commission_pct}%`}
                      {selectedStore.ext_billing_mode === 'flat_fee' && `Σταθερό €${selectedStore.ext_flat_fee}`}
                      {selectedStore.ext_billing_mode === 'driver_plus_margin' && `Οδηγός + ${selectedStore.ext_margin_pct}%`}
                    </Badge>
                  </div>
                  <Row label="Σύνολο παραγγελίας" value={`€${totalAmount.toFixed(2)}`} muted />
                  <Row label="Πληρωμή οδηγού" value={`€${preview?.driverPay.toFixed(2) ?? '0.00'}`} />
                  <Row label="Χρέωση καταστήματος" value={`€${preview?.storeCharge.toFixed(2) ?? '0.00'}`} />
                  <div className="border-t pt-3">
                    <Row
                      label="Κέρδος Πλατφόρμας"
                      value={`€${preview?.profit.toFixed(2) ?? '0.00'}`}
                      strong
                      negative={(preview?.profit ?? 0) <= 0}
                    />
                  </div>
                  {(preview?.profit ?? 0) <= 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive leading-snug">
                        Το κέρδος είναι ≤ 0. Σκέψου να αυξήσεις τη χρέωση καταστήματος ή να μειώσεις την πληρωμή οδηγού.
                      </p>
                    </div>
                  )}
                </>
              )}

              <Button onClick={handleSubmit} disabled={submitting} className="w-full gradient-primary text-primary-foreground font-heading gap-2 mt-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Δημιουργία & Αποστολή
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, muted, negative }: { label: string; value: string; strong?: boolean; muted?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${muted ? 'text-muted-foreground' : ''}`}>{label}</span>
      <span className={`font-heading tabular-nums ${strong ? 'text-base font-bold' : 'text-sm'} ${negative ? 'text-destructive' : strong ? 'text-primary' : ''}`}>
        {value}
      </span>
    </div>
  );
}
