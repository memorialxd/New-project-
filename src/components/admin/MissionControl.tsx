import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ShieldAlert, Power, Wallet, ShoppingBag, Trash2, Eye, ZapOff,
  CheckCircle2, AlertTriangle, RefreshCw, Bike, Store, UserCircle,
} from 'lucide-react';

/**
 * Mission Control — single page that gives an admin end-to-end
 * power over the platform: kill switches, wallet adjustments,
 * order force-completion, stale-data purge, and act-as links.
 */
export default function MissionControl() {
  const qc = useQueryClient();

  // ----- maintenance / kill switch -----
  const maint = useQuery({
    queryKey: ['mc-platform-settings'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('platform_settings').select('maintenance_mode, maintenance_message').eq('id', 1).maybeSingle();
      return data as { maintenance_mode: boolean; maintenance_message: string | null } | null;
    },
  });
  const [maintMsg, setMaintMsg] = useState('');
  const toggleMaintenance = async (on: boolean) => {
    const { error } = await (supabase as any).rpc('admin_toggle_maintenance', { p_on: on, p_message: maintMsg || null });
    if (error) toast.error(error.message);
    else { toast.success(on ? 'Πλατφόρμα σε συντήρηση' : 'Πλατφόρμα ενεργή'); qc.invalidateQueries({ queryKey: ['mc-platform-settings'] }); }
  };

  // ----- force-complete order -----
  const [orderId, setOrderId] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);
  const forceCompleteOrder = async () => {
    if (!orderId.trim()) return;
    setOrderBusy(true);
    const { error } = await (supabase as any).rpc('admin_force_complete_order', { p_order_id: orderId.trim() });
    setOrderBusy(false);
    if (error) toast.error(error.message);
    else { toast.success('Η παραγγελία ολοκληρώθηκε'); setOrderId(''); }
  };

  const cancelStuck = async () => {
    if (!confirm('Ακύρωση όλων των κολλημένων παραγγελιών > 2 ώρες;')) return;
    const { data, error } = await (supabase as any).rpc('admin_cancel_stuck_orders', { p_minutes: 120 });
    if (error) toast.error(error.message);
    else toast.success(`Ακυρώθηκαν ${(data as any)?.cancelled ?? 0} παραγγελίες`);
  };

  // ----- wallet adjustment -----
  const [walletKind, setWalletKind] = useState<'driver' | 'customer'>('driver');
  const [walletUser, setWalletUser] = useState('');
  const [walletAmount, setWalletAmount] = useState('');
  const [walletNote, setWalletNote] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const adjustWallet = async (sign: 1 | -1) => {
    const n = Number(walletAmount);
    if (!walletUser.trim() || !n || n <= 0) { toast.error('Συμπλήρωσε user id και ποσό > 0'); return; }
    setWalletBusy(true);
    const { error } = await (supabase as any).rpc('admin_wallet_adjust', {
      p_kind: walletKind, p_user_id: walletUser.trim(), p_amount: sign * n, p_note: walletNote || null,
    });
    setWalletBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(`${sign > 0 ? '+' : '−'}€${n.toFixed(2)} στο ${walletKind === 'driver' ? 'driver' : 'customer'} wallet`); setWalletAmount(''); setWalletNote(''); }
  };

  // ----- purge stale data -----
  const purge = async (kind: 'dispatch_runs' | 'offer_events' | 'audit', label: string) => {
    if (!confirm(`Διαγραφή ${label};`)) return;
    const { data, error } = await (supabase as any).rpc('admin_purge_stale', { p_kind: kind });
    if (error) toast.error(error.message);
    else toast.success(`Διαγράφηκαν ${(data as any)?.purged ?? 0} εγγραφές`);
  };

  const isMaint = !!maint.data?.maintenance_mode;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-5 w-5 text-destructive" />
        </div>
        <div>
          <h2 className="font-heading font-bold text-xl">Mission Control</h2>
          <p className="text-sm text-muted-foreground">Πλήρης έλεγχος πλατφόρμας από ένα σημείο — kill switches, χειροκίνητες παρεμβάσεις, εκκαθαρίσεις, impersonation.</p>
        </div>
      </div>

      {/* Kill switch hero */}
      <Card className={isMaint ? 'border-destructive/50 bg-destructive/5' : ''}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Power className={`h-4 w-4 ${isMaint ? 'text-destructive' : 'text-success'}`} />
            Κατάσταση πλατφόρμας
            <Badge variant={isMaint ? 'destructive' : 'outline'} className="ml-2">
              {isMaint ? 'ΣΥΝΤΗΡΗΣΗ' : 'ΕΝΕΡΓΗ'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">Λειτουργία συντήρησης</p>
              <p className="text-[11px] text-muted-foreground">Όλοι οι πελάτες βλέπουν banner συντήρησης και νέες παραγγελίες μπλοκάρονται.</p>
            </div>
            <Switch checked={isMaint} onCheckedChange={toggleMaintenance} />
          </div>
          <div>
            <Label className="text-[11px]">Μήνυμα συντήρησης (προαιρετικό)</Label>
            <Textarea value={maintMsg} onChange={e => setMaintMsg(e.target.value)} placeholder={maint.data?.maintenance_message ?? 'π.χ. Επιστρέφουμε σε 30 λεπτά.'} className="mt-1" rows={2} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="orders">
        <TabsList className="grid grid-cols-4 w-full max-w-3xl">
          <TabsTrigger value="orders" className="gap-1.5"><ShoppingBag className="h-3.5 w-3.5" /> Orders</TabsTrigger>
          <TabsTrigger value="wallets" className="gap-1.5"><Wallet className="h-3.5 w-3.5" /> Wallets</TabsTrigger>
          <TabsTrigger value="cleanup" className="gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Cleanup</TabsTrigger>
          <TabsTrigger value="actas" className="gap-1.5"><Eye className="h-3.5 w-3.5" /> Act as</TabsTrigger>
        </TabsList>

        {/* Orders */}
        <TabsContent value="orders" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Force-complete παραγγελίας</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-[11px]">Order ID (UUID)</Label>
                <Input value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="00000000-0000-..." />
              </div>
              <Button onClick={forceCompleteOrder} disabled={orderBusy || !orderId.trim()} className="bg-success hover:bg-success/90 text-success-foreground">
                <CheckCircle2 className="h-4 w-4 mr-1" /> Σήμανση ως delivered
              </Button>
              <p className="text-[11px] text-muted-foreground">Θα τρέξει το commission trigger και θα πιστώσει οδηγό/κατάστημα/admin κανονικά.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /> Bulk: ακύρωση κολλημένων</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={cancelStuck}>
                <ZapOff className="h-4 w-4 mr-1" /> Ακύρωσε pending/placed &gt; 2h
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Wallets */}
        <TabsContent value="wallets" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /> Χειροκίνητη πίστωση / χρέωση</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">Τύπος πορτοφολιού</Label>
                  <Select value={walletKind} onValueChange={(v) => setWalletKind(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Οδηγός</SelectItem>
                      <SelectItem value="customer">Πελάτης</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">User ID (UUID)</Label>
                  <Input value={walletUser} onChange={e => setWalletUser(e.target.value)} placeholder="00000000-..." />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">Ποσό (€)</Label>
                  <Input type="number" step="0.01" min="0" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <Label className="text-[11px]">Σημείωση</Label>
                  <Input value={walletNote} onChange={e => setWalletNote(e.target.value)} placeholder="π.χ. αποζημίωση" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => adjustWallet(1)} disabled={walletBusy} className="bg-success hover:bg-success/90 text-success-foreground flex-1">+ Πίστωση</Button>
                <Button onClick={() => adjustWallet(-1)} disabled={walletBusy} variant="destructive" className="flex-1">− Χρέωση</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Κάθε ενέργεια γράφεται στο ledger και στο audit log.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cleanup */}
        <TabsContent value="cleanup" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Trash2 className="h-4 w-4 text-muted-foreground" /> Εκκαθαρίσεις βάσης</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => purge('dispatch_runs', 'dispatch_runs > 24h')}>
                <RefreshCw className="h-4 w-4 mr-1" /> Dispatch runs &gt; 24h
              </Button>
              <Button variant="outline" onClick={() => purge('offer_events', 'offer events > 7d')}>
                <RefreshCw className="h-4 w-4 mr-1" /> Offer events &gt; 7d
              </Button>
              <Button variant="outline" onClick={() => purge('audit', 'audit log > 90d')}>
                <RefreshCw className="h-4 w-4 mr-1" /> Audit log &gt; 90d
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Act-as */}
        <TabsContent value="actas" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4 text-info" /> Άνοιξε ως</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => window.open('/', '_blank')}><UserCircle className="h-4 w-4 mr-1" /> Πελάτης</Button>
              <Button variant="outline" onClick={() => window.open('/driver', '_blank')}><Bike className="h-4 w-4 mr-1" /> Οδηγός</Button>
              <Button variant="outline" onClick={() => window.open('/store', '_blank')}><Store className="h-4 w-4 mr-1" /> Κατάστημα</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
