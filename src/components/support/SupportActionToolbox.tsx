import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle, MapPin, Wallet, Ban, RotateCcw, BellRing, Siren, Phone, Loader2, Zap,
  XCircle, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { DriverLocationDialog } from './DriverLocationDialog';

interface Props {
  ticket: any;
  driver: { full_name?: string | null; phone?: string | null } | undefined;
  onDriverChanged?: () => void;
}

type DialogKey = null | 'location' | 'credit' | 'suspend' | 'broadcast' | 'sos' | 'unassign' | 'cancel_order' | 'modify_order';

export function SupportActionToolbox({ ticket, driver, onDriverChanged }: Props) {
  const { isAdmin, isSupport } = useAuth();
  const creditMax = isAdmin ? 20 : isSupport ? 5 : 0;
  const [open, setOpen] = useState<DialogKey>(null);
  const [loading, setLoading] = useState(false);

  // Shared dialog state
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'urgent'>('info');
  const [suspending, setSuspending] = useState(true);

  // Order modify state
  const [editTotal, setEditTotal] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editTip, setEditTip] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editReason, setEditReason] = useState('');

  const driverId = ticket.driver_id as string;
  const orderId = ticket.order_id as string | null;

  const reset = () => {
    setAmount(''); setReason(''); setTitle(''); setBody(''); setSeverity('info'); setSuspending(true);
    setEditTotal(''); setEditFee(''); setEditTip(''); setEditAddress(''); setEditReason('');
  };

  const close = () => { setOpen(null); reset(); setLoading(false); };

  // ─── Actions ────────────────────────────────────────
  const sendChatNote = async (text: string) => {
    await (supabase as any).from('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_role: 'support',
      message: text,
    });
  };

  const submitCredit = async () => {
    if (creditMax <= 0) return toast.error('Δεν έχεις δικαίωμα πίστωσης');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || amt > creditMax) return toast.error(`Ποσό 0–${creditMax}€`);
    if (!reason.trim()) return toast.error('Συμπλήρωσε αιτιολογία');
    setLoading(true);
    const { error } = await (supabase as any).rpc('support_credit_wallet', {
      p_driver_id: driverId, p_amount: amt, p_reason: reason,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    await sendChatNote(`💰 Πιστώθηκαν ${amt.toFixed(2)}€ στο πορτοφόλι σου: ${reason}`);
    toast.success('Πορτοφόλι πιστώθηκε');
    close();
  };

  const submitSuspend = async () => {
    if (suspending && !reason.trim()) return toast.error('Συμπλήρωσε λόγο');
    setLoading(true);
    const { error } = await (supabase as any).rpc('support_suspend_driver', {
      p_driver_id: driverId, p_reason: reason || null, p_suspend: suspending,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    await sendChatNote(
      suspending
        ? `⛔ Ο λογαριασμός σου ανεστάλη προσωρινά: ${reason}`
        : `✅ Ο λογαριασμός σου επανενεργοποιήθηκε.`
    );
    toast.success(suspending ? 'Σε αναστολή' : 'Επανενεργοποιήθηκε');
    onDriverChanged?.();
    close();
  };

  const submitBroadcast = async () => {
    if (!title.trim() || !body.trim()) return toast.error('Συμπλήρωσε τίτλο και μήνυμα');
    setLoading(true);
    const { error } = await (supabase as any).from('driver_notifications').insert({
      driver_id: driverId,
      title, body, severity,
      sender_id: (await supabase.auth.getUser()).data.user?.id ?? null,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success('Push εστάλη στον οδηγό');
    close();
  };

  const submitSos = async () => {
    setLoading(true);
    // Bump priority + insert fraud signal as escalation marker
    await (supabase as any).from('support_tickets').update({ priority: 'sos', status: 'in_progress' }).eq('id', ticket.id);
    await (supabase as any).from('fraud_signals').insert({
      user_id: driverId,
      signal_type: 'emergency_escalation',
      severity: 'high',
      details: {
        ticket_id: ticket.id,
        order_id: orderId,
        notes: reason || 'Emergency escalated by support',
      },
    });
    await sendChatNote(`🚨 Έγινε κλιμάκωση εκτάκτου. Παραμείνετε ασφαλείς. Καλούμε άμεσα.`);
    toast.success('SOS κλιμακώθηκε');
    close();
  };

  const submitUnassign = async () => {
    if (!orderId) return;
    setLoading(true);
    const { error } = await (supabase as any).rpc('support_unassign_order', { p_order_id: orderId });
    if (error) { toast.error(error.message); setLoading(false); return; }
    await sendChatNote(`🔄 Η παραγγελία αφαιρέθηκε από εσένα και θα δοθεί σε άλλον οδηγό.`);
    toast.success('Επιστράφηκε στη διανομή');
    close();
  };

  const submitCancelOrder = async () => {
    if (!orderId) return;
    if (!reason.trim()) return toast.error('Συμπλήρωσε λόγο ακύρωσης');
    setLoading(true);
    const { error } = await (supabase as any).rpc('support_cancel_order', {
      p_order_id: orderId, p_reason: reason,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    await sendChatNote(`❌ Η παραγγελία #${orderId.slice(0, 8)} ακυρώθηκε από support: ${reason}`);
    toast.success('Παραγγελία ακυρώθηκε');
    close();
  };

  const openModifyDialog = async () => {
    if (!orderId) return;
    // Prefill from current order
    const { data } = await (supabase as any)
      .from('orders')
      .select('total_amount, delivery_fee, tip_amount, delivery_address')
      .eq('id', orderId)
      .maybeSingle();
    if (data) {
      setEditTotal(String(data.total_amount ?? ''));
      setEditFee(String(data.delivery_fee ?? ''));
      setEditTip(String(data.tip_amount ?? ''));
      setEditAddress(data.delivery_address ?? '');
    }
    setOpen('modify_order');
  };

  const submitModifyOrder = async () => {
    if (!orderId) return;
    if (!editReason.trim()) return toast.error('Συμπλήρωσε λόγο τροποποίησης');
    setLoading(true);
    const { error } = await (supabase as any).rpc('support_modify_order', {
      p_order_id: orderId,
      p_total_amount:    editTotal === '' ? null : Number(editTotal),
      p_delivery_fee:    editFee   === '' ? null : Number(editFee),
      p_tip_amount:      editTip   === '' ? null : Number(editTip),
      p_delivery_address: editAddress || null,
      p_change_reason:   editReason,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    await sendChatNote(`✏️ Η παραγγελία #${orderId.slice(0, 8)} τροποποιήθηκε: ${editReason}`);
    toast.success('Παραγγελία τροποποιήθηκε');
    close();
  };

  // ─── Render ─────────────────────────────────────────
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wide font-heading font-bold text-muted-foreground flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" /> Ενέργειες υποστήριξης
        </p>

        <div className="grid grid-cols-2 gap-1.5">
          <ToolBtn icon={MapPin} label="Θέση οδηγού" onClick={() => setOpen('location')} />
          <ToolBtn icon={BellRing} label="Push μήνυμα" onClick={() => setOpen('broadcast')} />
          <ToolBtn icon={Wallet} label="Πίστωση €" onClick={() => setOpen('credit')} />
          
          <ToolBtn icon={Ban} label="Αναστολή" tone="warn" onClick={() => setOpen('suspend')} />
          <ToolBtn
            icon={RotateCcw}
            label="Αλλαγή οδηγού"
            disabled={!orderId}
            onClick={() => setOpen('unassign')}
          />
          <ToolBtn
            icon={Pencil}
            label="Τροπ. παραγγελίας"
            disabled={!orderId}
            onClick={openModifyDialog}
          />
          <ToolBtn
            icon={XCircle}
            label="Ακύρωση παραγγ."
            tone="danger"
            disabled={!orderId}
            onClick={() => setOpen('cancel_order')}
          />
          <ToolBtn icon={Siren} label="SOS κλιμάκωση" tone="danger" onClick={() => setOpen('sos')} />
        </div>

        {/* Location dialog (separate component) */}
        <DriverLocationDialog
          open={open === 'location'}
          onOpenChange={(o) => !o && close()}
          driverId={driverId}
          driverName={driver?.full_name ?? undefined}
        />

        {/* Credit wallet */}
        <Dialog open={open === 'credit'} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Πίστωση πορτοφολιού</DialogTitle>
              <DialogDescription>Έως {creditMax}€ ανά αίτημα ({isAdmin ? 'admin – 30 φορές/μήνα' : 'support – 5 φορές/μήνα'}). Καταγράφεται στο ιστορικό συναλλαγών του οδηγού.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Ποσό (€)</Label>
                <Input type="number" step="0.5" min="0" max={creditMax} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={isAdmin ? 'π.χ. 10.00' : 'π.χ. 3.00'} />
              </div>
              <div>
                <Label>Αιτιολογία</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="π.χ. Αποζημίωση καυσίμου λόγω λάθος διεύθυνσης" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitCredit} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Πίστωση
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Suspend / reactivate */}
        <Dialog open={open === 'suspend'} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Ban className="h-5 w-5" /> Αναστολή / Επανενεργοποίηση</DialogTitle>
              <DialogDescription>Επιλέξτε ενέργεια. Η αναστολή σταματάει αμέσως νέες παραγγελίες.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={suspending ? 'suspend' : 'reactivate'} onValueChange={(v) => setSuspending(v === 'suspend')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="suspend">⛔ Αναστολή</SelectItem>
                  <SelectItem value="reactivate">✅ Επανενεργοποίηση</SelectItem>
                </SelectContent>
              </Select>
              {suspending && (
                <div>
                  <Label>Λόγος</Label>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="π.χ. Παράβαση όρων χρήσης" />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitSuspend} variant={suspending ? 'destructive' : 'default'} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {suspending ? 'Αναστολή' : 'Επανενεργοποίηση'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Push broadcast */}
        <Dialog open={open === 'broadcast'} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" /> Στείλε push στον οδηγό</DialogTitle>
              <DialogDescription>Εμφανίζεται ως toast στην εφαρμογή του οδηγού.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Σοβαρότητα</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">📢 Πληροφορία</SelectItem>
                    <SelectItem value="warning">⚠️ Προειδοποίηση</SelectItem>
                    <SelectItem value="urgent">🚨 Έκτακτο</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Τίτλος</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="π.χ. Πρόβλημα στην εφαρμογή" />
              </div>
              <div>
                <Label>Μήνυμα</Label>
                <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="π.χ. Σταμάτησε να δέχεσαι παραγγελίες για 10 λεπτά." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitBroadcast} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Αποστολή
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SOS escalation */}
        <Dialog open={open === 'sos'} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive"><Siren className="h-5 w-5" /> Κλιμάκωση εκτάκτου</DialogTitle>
              <DialogDescription>Σήμανση ως SOS, καταγραφή ως fraud_signal εκτάκτου, και αυτόματο μήνυμα στον οδηγό.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-xs space-y-1">
                <p><b>Οδηγός:</b> {driver?.full_name ?? '—'}</p>
                <p><b>Τηλέφωνο:</b> {driver?.phone ?? '—'}</p>
                {orderId && <p><b>Παραγγελία:</b> #{orderId.slice(0, 8)}</p>}
              </div>
              <div>
                <Label>Σημειώσεις (προαιρετικά)</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Σύντομη περιγραφή του εκτάκτου" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" asChild>
                  <a href="tel:112"><Phone className="h-4 w-4 mr-1" /> Καλέστε 112</a>
                </Button>
                {driver?.phone && (
                  <Button variant="outline" className="flex-1" asChild>
                    <a href={`tel:${driver.phone}`}><Phone className="h-4 w-4 mr-1" /> Καλέστε οδηγό</a>
                  </Button>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitSos} variant="destructive" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Κλιμάκωση
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unassign order */}
        <Dialog open={open === 'unassign'} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" /> Αλλαγή οδηγού στην παραγγελία</DialogTitle>
              <DialogDescription>
                Η παραγγελία θα αφαιρεθεί από αυτόν τον οδηγό και θα επιστρέψει στη διανομή για να την πάρει άλλος.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">Παραγγελία: <b>#{orderId?.slice(0, 8)}</b></p>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitUnassign} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Επιστροφή στη διανομή
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel order */}
        <Dialog open={open === 'cancel_order'} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" /> Ακύρωση παραγγελίας
              </DialogTitle>
              <DialogDescription>
                Η παραγγελία <b>#{orderId?.slice(0, 8)}</b> θα σημανθεί ως ακυρωμένη.
                Δεν επιτρέπεται για παραδομένες παραγγελίες — εκεί χρησιμοποίησε επιστροφή χρημάτων.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label>Λόγος ακύρωσης</Label>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="π.χ. Πελάτης δεν απαντά, λάθος διεύθυνση, διπλή παραγγελία" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitCancelOrder} variant="destructive" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Ακύρωση
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modify order */}
        <Dialog open={open === 'modify_order'} onOpenChange={(o) => !o && close()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5" /> Τροποποίηση παραγγελίας
              </DialogTitle>
              <DialogDescription>
                Άφησε κενά πεδία για να μην αλλάξουν. Δεν επιτρέπεται σε παραδομένες ή ακυρωμένες παραγγελίες.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Σύνολο €</Label>
                  <Input type="number" step="0.01" min="0" value={editTotal} onChange={(e) => setEditTotal(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Διανομή €</Label>
                  <Input type="number" step="0.01" min="0" value={editFee} onChange={(e) => setEditFee(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Φιλοδώρ. €</Label>
                  <Input type="number" step="0.01" min="0" value={editTip} onChange={(e) => setEditTip(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Διεύθυνση παράδοσης</Label>
                <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="Νέα διεύθυνση" />
              </div>
              <div>
                <Label className="text-xs">Λόγος αλλαγής (υποχρεωτικό)</Label>
                <Textarea rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="π.χ. Διόρθωση τιμής μετά από καταγγελία πελάτη" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Άκυρο</Button>
              <Button onClick={submitModifyOrder} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Αποθήκευση αλλαγών
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function ToolBtn({
  icon: Icon, label, onClick, disabled, tone,
}: {
  icon: any; label: string; onClick: () => void; disabled?: boolean;
  tone?: 'warn' | 'danger';
}) {
  const cls =
    tone === 'danger'
      ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
      : tone === 'warn'
      ? 'border-orange-500/30 text-orange-600 hover:bg-orange-500/10'
      : '';
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className={`h-10 sm:h-9 text-[11px] justify-start ${cls}`}
    >
      <Icon className="h-3.5 w-3.5 mr-1.5" />
      {label}
    </Button>
  );
}
