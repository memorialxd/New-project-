import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Radio, Zap, ShieldAlert, Timer, UserCog, PauseCircle, PlayCircle,
  Wallet, RotateCcw, Loader2, Search, AlertTriangle, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatOrderNumber } from '@/lib/order-number';

type Dlg =
  | null | 'reassign' | 'extend' | 'pause' | 'credit_customer' | 'refund' | 'unassign' | 'cancel';

type LiveOrder = {
  id: string;
  status: string;
  store_id: string | null;
  driver_id: string | null;
  customer_id: string | null;
  total_amount: number | null;
  delivery_address: string | null;
  store_order_number: number | null;
  created_at: string;
  batch_id: string | null;
};

type Offer = {
  id: string;
  order_id: string;
  driver_id: string;
  status: string;
  expires_at: string;
};

export default function DeliveryControlCenter() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  // Live active orders
  const { data: orders = [] } = useQuery({
    queryKey: ['dcc-orders'],
    refetchInterval: 8000,
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select('id,status,store_id,driver_id,customer_id,total_amount,delivery_address,store_order_number,created_at,batch_id')
        .in('status', ['pending', 'placed', 'accepted', 'preparing', 'ready', 'picked_up'])
        .order('created_at', { ascending: false })
        .limit(120);
      return (data ?? []) as LiveOrder[];
    },
  });

  // Live drivers (online / on shift)
  const { data: driverProfiles = [] } = useQuery({
    queryKey: ['dcc-drivers'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .eq('role', 'driver');
      return data ?? [];
    },
  });

  const { data: driverStates = [] } = useQuery({
    queryKey: ['dcc-driver-states'],
    refetchInterval: 10000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('driver_state')
        .select('driver_id, on_break, break_until');
      return data ?? [];
    },
  });

  // Pending offers
  const { data: offers = [] } = useQuery({
    queryKey: ['dcc-offers'],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await supabase
        .from('pending_offers')
        .select('id, order_id, driver_id, status, expires_at')
        .eq('status', 'pending')
        .order('expires_at', { ascending: true });
      return (data ?? []) as Offer[];
    },
  });

  // Dispatch kill switch state
  const { data: flag } = useQuery({
    queryKey: ['dcc-dispatch-flag'],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('feature_flags')
        .select('key,is_enabled')
        .eq('key', 'dispatch_enabled')
        .maybeSingle();
      return data;
    },
  });
  const dispatchOn = flag?.is_enabled !== false;

  // Realtime refresh
  useEffect(() => {
    const ch = supabase
      .channel('dcc-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },
        () => qc.invalidateQueries({ queryKey: ['dcc-orders'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_offers' },
        () => qc.invalidateQueries({ queryKey: ['dcc-offers'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const driverName = (id?: string | null) =>
    (id && driverProfiles.find((d: any) => d.user_id === id)?.full_name) || (id ? id.slice(0, 6) : '—');

  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders;
    const s = search.toLowerCase();
    return orders.filter(o =>
      o.id.toLowerCase().includes(s) ||
      (o.delivery_address ?? '').toLowerCase().includes(s) ||
      String(o.store_order_number ?? '').includes(s)
    );
  }, [orders, search]);

  // Selected order/driver for dialogs
  const [target, setTarget] = useState<{ orderId?: string; driverId?: string; offerId?: string }>({});
  // form fields
  const [reassignDriverId, setReassignDriverId] = useState('');
  const [extendSec, setExtendSec] = useState(30);
  const [pauseMin, setPauseMin] = useState(15);
  const [creditAmt, setCreditAmt] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [refundAmt, setRefundAmt] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const close = () => {
    setDlg(null); setBusy(false); setTarget({});
    setReassignDriverId(''); setExtendSec(30); setPauseMin(15);
    setCreditAmt(''); setCreditReason(''); setRefundAmt('');
    setRefundReason(''); setCancelReason('');
  };

  // ── Actions ────────────────────────────────────────
  const call = async (rpc: string, args: any, okMsg: string) => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)(rpc, args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(okMsg);
    qc.invalidateQueries({ queryKey: ['dcc-orders'] });
    qc.invalidateQueries({ queryKey: ['dcc-offers'] });
    qc.invalidateQueries({ queryKey: ['dcc-driver-states'] });
    close();
  };

  const doReassign = () => {
    if (!target.orderId || !reassignDriverId) return toast.error('Επίλεξε οδηγό');
    call('admin_force_assign_order', {
      p_order_id: target.orderId, p_driver_id: reassignDriverId, p_reason: 'DCC reassign',
    }, 'Η παραγγελία ανατέθηκε');
  };
  const doExtend = () => {
    if (!target.offerId) return;
    call('admin_extend_offer', { p_offer_id: target.offerId, p_extra_seconds: extendSec },
      `Επεκτάθηκε +${extendSec}s`);
  };
  const doPause = () => {
    if (!target.driverId) return;
    call('admin_pause_driver_offers', { p_driver_id: target.driverId, p_minutes: pauseMin },
      pauseMin > 0 ? `Οδηγός σε παύση ${pauseMin} λεπτά` : 'Παύση αναιρέθηκε');
  };
  const doCredit = () => {
    if (!target.driverId) return; // driverId slot reused for customer
    const amt = Number(creditAmt);
    if (!amt) return toast.error('Ποσό');
    call('admin_credit_customer_wallet', {
      p_customer_id: target.driverId, p_amount: amt, p_reason: creditReason,
    }, `+${amt.toFixed(2)}€ στο wallet πελάτη`);
  };
  const doRefund = () => {
    if (!target.orderId) return;
    const amt = Number(refundAmt);
    if (!amt) return toast.error('Ποσό');
    call('admin_refund_order', {
      p_order_id: target.orderId, p_amount: amt, p_reason: refundReason || null,
    }, `Επιστράφηκαν ${amt.toFixed(2)}€`);
  };
  const doUnassign = () => {
    if (!target.orderId) return;
    call('support_unassign_order', { p_order_id: target.orderId }, 'Επιστράφηκε στη διανομή');
  };
  const doCancel = () => {
    if (!target.orderId) return;
    if (!cancelReason.trim()) return toast.error('Λόγος');
    call('support_cancel_order', { p_order_id: target.orderId, p_reason: cancelReason },
      'Παραγγελία ακυρώθηκε');
  };

  const toggleDispatch = async () => {
    if (!isAdmin) return toast.error('Μόνο admin');
    setBusy(true);
    const { error } = await (supabase.rpc as any)('admin_set_dispatch_enabled', { p_enabled: !dispatchOn });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(dispatchOn ? 'Dispatch stopped' : 'Dispatch resumed');
    qc.invalidateQueries({ queryKey: ['dcc-dispatch-flag'] });
  };

  const runDispatchNow = async () => {
    setBusy(true);
    const { error } = await supabase.functions.invoke('auto-dispatch', { body: { manual: true } });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Dispatch τρέχει τώρα');
  };

  // ── Render ────────────────────────────────────────
  const orderById = (id: string) => orders.find(o => o.id === id);
  const offerCountdown = (iso: string) => {
    const s = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
    return `${s}s`;
  };
  const isPaused = (id: string) => {
    const st = (driverStates as any[]).find(s => s.driver_id === id);
    return !!(st?.on_break && (!st.break_until || new Date(st.break_until) > new Date()));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-heading font-extrabold text-xl flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> Delivery Control Center
          </h2>
          <p className="text-sm text-muted-foreground">
            Ζωντανές παρεμβάσεις σε παραγγελίες, οδηγούς, προσφορές και dispatch.
          </p>
        </div>

        {/* Global kill switch + manual dispatch */}
        <div className="flex items-center gap-2">
          <Card className={dispatchOn ? '' : 'border-destructive/40 bg-destructive/5'}>
            <CardContent className="p-2.5 flex items-center gap-3">
              <div className="flex items-center gap-2">
                {dispatchOn
                  ? <Radio className="h-4 w-4 text-emerald-600" />
                  : <ShieldAlert className="h-4 w-4 text-destructive" />}
                <div className="text-xs">
                  <p className="font-semibold leading-tight">Global Dispatch</p>
                  <p className="text-[10px] text-muted-foreground">{dispatchOn ? 'Active' : 'PAUSED'}</p>
                </div>
              </div>
              <Switch checked={dispatchOn} disabled={!isAdmin || busy} onCheckedChange={toggleDispatch} />
            </CardContent>
          </Card>
          <Button size="sm" variant="outline" onClick={runDispatchNow} disabled={busy}>
            <Zap className="h-3.5 w-3.5 mr-1.5" /> Τρέξε dispatch τώρα
          </Button>
        </div>
      </div>

      {/* Active offers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Timer className="h-4 w-4 text-primary" /> Ενεργές προσφορές ({offers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {offers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Καμία ενεργή προσφορά.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {offers.map(o => {
                const ord = orderById(o.order_id);
                return (
                  <div key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">
                        {ord ? formatOrderNumber(ord) : '#' + o.order_id.slice(0, 6)}
                        <span className="ml-2 text-muted-foreground">→ {driverName(o.driver_id)}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{ord?.delivery_address ?? '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="tabular-nums">{offerCountdown(o.expires_at)}</Badge>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                        onClick={() => { setTarget({ offerId: o.id }); setDlg('extend'); }}>
                        +sec
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active orders */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Ζωντανές παραγγελίες ({filteredOrders.length})
            </CardTitle>
            <div className="relative w-56">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Αναζήτηση #, διεύθυνση..." className="h-8 pl-7 text-xs" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="space-y-1.5 max-h-[420px] overflow-auto">
            {filteredOrders.map(o => (
              <div key={o.id} className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">
                      {formatOrderNumber(o)}
                      <Badge variant="outline" className="ml-2 h-5 text-[10px] uppercase">{o.status}</Badge>
                      {o.batch_id && <Badge variant="outline" className="ml-1 h-5 text-[10px]">Stack</Badge>}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {o.delivery_address ?? '—'} · {Number(o.total_amount ?? 0).toFixed(2)}€
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Οδηγός: <span className="font-medium text-foreground">{o.driver_id ? driverName(o.driver_id) : '— unassigned'}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                      onClick={() => { setTarget({ orderId: o.id }); setDlg('reassign'); }}>
                      <UserCog className="h-3 w-3 mr-1" /> Ανάθεση
                    </Button>
                    {o.driver_id && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                        onClick={() => { setTarget({ orderId: o.id }); setDlg('unassign'); }}>
                        <RotateCcw className="h-3 w-3 mr-1" /> Αφαίρεση
                      </Button>
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                        onClick={() => {
                          setTarget({ orderId: o.id });
                          setRefundAmt(String(o.total_amount ?? '')); setDlg('refund');
                        }}>
                        <Wallet className="h-3 w-3 mr-1" /> Refund
                      </Button>
                    )}
                    {isAdmin && o.customer_id && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                        onClick={() => { setTarget({ driverId: o.customer_id! }); setDlg('credit_customer'); }}>
                        +€ Wallet
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] text-destructive"
                      onClick={() => { setTarget({ orderId: o.id }); setDlg('cancel'); }}>
                      <AlertTriangle className="h-3 w-3 mr-1" /> Ακύρωση
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {filteredOrders.length === 0 && (
              <p className="text-xs text-muted-foreground py-6 text-center">Καμία παραγγελία.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Driver quick pause */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-primary" /> Παύση / Επαναφορά οδηγών
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-auto">
            {(driverProfiles as any[]).map(d => {
              const paused = isPaused(d.user_id);
              return (
                <div key={d.user_id}
                  className={`flex items-center justify-between gap-2 rounded-md border p-2 text-xs ${paused ? 'border-warning/40 bg-warning/5' : 'border-border'}`}>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.full_name || d.user_id.slice(0, 6)}</p>
                    <p className="text-[10px] text-muted-foreground">{paused ? '⏸ Σε παύση' : 'Διαθέσιμος'}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                      onClick={() => { setTarget({ driverId: d.user_id }); setPauseMin(15); setDlg('pause'); }}>
                      {paused ? <PlayCircle className="h-3 w-3" /> : <PauseCircle className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Dialogs ────────────────────────────────── */}
      <Dialog open={dlg === 'reassign'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force-assign σε οδηγό</DialogTitle>
            <DialogDescription>Ακυρώνει ενεργές προσφορές και αναθέτει άμεσα.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Οδηγός</Label>
            <Select value={reassignDriverId} onValueChange={setReassignDriverId}>
              <SelectTrigger><SelectValue placeholder="Επίλεξε οδηγό" /></SelectTrigger>
              <SelectContent>
                {(driverProfiles as any[]).map(d => (
                  <SelectItem key={d.user_id} value={d.user_id}>{d.full_name || d.user_id.slice(0, 6)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button onClick={doReassign} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Ανάθεση
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'extend'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Επέκταση προσφοράς</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Επιπλέον δευτερόλεπτα (1–600)</Label>
            <Input type="number" min={1} max={600} value={extendSec}
              onChange={e => setExtendSec(Number(e.target.value) || 0)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button onClick={doExtend} disabled={busy}>Επέκταση</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'pause'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Παύση οδηγού</DialogTitle>
            <DialogDescription>0 = επαναφορά. Max 720 λεπτά.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Λεπτά</Label>
            <Input type="number" min={0} max={720} value={pauseMin}
              onChange={e => setPauseMin(Number(e.target.value) || 0)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button onClick={doPause} disabled={busy}>{pauseMin > 0 ? 'Παύση' : 'Επαναφορά'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'credit_customer'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Πίστωση wallet πελάτη</DialogTitle>
            <DialogDescription>Admin-only. Max 20€ ανά αίτημα.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Ποσό (€)</Label>
              <Input type="number" step="0.5" min="0" max={20} value={creditAmt}
                onChange={e => setCreditAmt(e.target.value)} /></div>
            <div><Label>Αιτιολογία</Label>
              <Textarea rows={2} value={creditReason} onChange={e => setCreditReason(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button onClick={doCredit} disabled={busy}>Πίστωση</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'refund'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Επιστροφή πελάτη</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Ποσό (€)</Label>
              <Input type="number" step="0.5" min="0" value={refundAmt}
                onChange={e => setRefundAmt(e.target.value)} /></div>
            <div><Label>Αιτιολογία</Label>
              <Textarea rows={2} value={refundReason} onChange={e => setRefundReason(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button onClick={doRefund} disabled={busy}>Επιστροφή</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'unassign'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Αφαίρεση οδηγού</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Η παραγγελία επιστρέφει στη διανομή.</p>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button onClick={doUnassign} disabled={busy}>Αφαίρεση</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'cancel'} onOpenChange={o => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Ακύρωση παραγγελίας</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Λόγος</Label>
            <Textarea rows={3} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Άκυρο</Button>
            <Button variant="destructive" onClick={doCancel} disabled={busy}>Ακύρωση</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
