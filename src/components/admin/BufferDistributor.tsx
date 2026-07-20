import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Wallet, Plus, Minus, Equal, Target, Shield, Flame, Trophy, Send, History, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { el } from 'date-fns/locale';

type Tab = 'overview' | 'quests' | 'guarantees' | 'surge' | 'streaks' | 'distribute';

export default function BufferDistributor() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-4">
      <header>
        <h3 className="font-heading font-bold text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" /> Driver Buffer — Control Room
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Quests, guarantees, surge zones & streaks. Auto-fill 10%/order · manual top-up/drain.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid grid-cols-3 sm:grid-cols-6 h-auto">
          <TabsTrigger value="overview" className="text-xs">Επισκόπηση</TabsTrigger>
          <TabsTrigger value="quests" className="text-xs">Quests</TabsTrigger>
          <TabsTrigger value="guarantees" className="text-xs">Εγγυήσεις</TabsTrigger>
          <TabsTrigger value="surge" className="text-xs">Surge</TabsTrigger>
          <TabsTrigger value="streaks" className="text-xs">Streaks</TabsTrigger>
          <TabsTrigger value="distribute" className="text-xs">Διανομή</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="quests" className="mt-4"><QuestsTab /></TabsContent>
        <TabsContent value="guarantees" className="mt-4"><GuaranteesTab /></TabsContent>
        <TabsContent value="surge" className="mt-4"><SurgeTab /></TabsContent>
        <TabsContent value="streaks" className="mt-4"><StreaksTab /></TabsContent>
        <TabsContent value="distribute" className="mt-4"><DistributeTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ OVERVIEW ============================ */

function OverviewTab() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('50');
  const [action, setAction] = useState<'add' | 'remove' | 'set'>('add');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [adminAmount, setAdminAmount] = useState('50');
  const [adminAction, setAdminAction] = useState<'add' | 'remove' | 'set'>('add');
  const [adminReason, setAdminReason] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);

  const treasury = useQuery({
    queryKey: ['admin-treasury-buffer'],
    refetchInterval: 10000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('admin_treasury')
        .select('platform_pool, admin_balance').eq('id', 1).maybeSingle();
      return data ?? { platform_pool: 0, admin_balance: 0 };
    },
  });

  const ledger = useQuery({
    queryKey: ['buffer-ledger'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('admin_treasury_ledger')
        .select('id, type, amount, description, created_at, bag')
        .in('bag', ['platform_pool', 'platform', 'admin'])
        .order('created_at', { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const pool = Number(treasury.data?.platform_pool ?? 0);
  const adminBal = Number(treasury.data?.admin_balance ?? 0);

  const handleAdjust = async () => {
    const amt = Number(amount);
    if (!amt || amt < 0) return toast.error('Δώσε έγκυρο ποσό');
    setBusy(true);
    const { data, error } = await (supabase as any).rpc('admin_adjust_buffer', {
      p_amount: amt, p_action: action, p_reason: reason || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Driver Buffer: €${Number(data.before).toFixed(2)} → €${Number(data.after).toFixed(2)}`);
    setReason('');
    qc.invalidateQueries({ queryKey: ['admin-treasury-buffer'] });
    qc.invalidateQueries({ queryKey: ['buffer-ledger'] });
  };

  const handleAdminAdjust = async () => {
    const amt = Number(adminAmount);
    if (!amt || amt < 0) return toast.error('Δώσε έγκυρο ποσό');
    setAdminBusy(true);
    const { data, error } = await (supabase as any).rpc('admin_adjust_admin_buffer', {
      p_amount: amt, p_action: adminAction, p_reason: adminReason || null,
    });
    setAdminBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Admin Buffer: €${Number(data.before).toFixed(2)} → €${Number(data.after).toFixed(2)}`);
    setAdminReason('');
    qc.invalidateQueries({ queryKey: ['admin-treasury-buffer'] });
    qc.invalidateQueries({ queryKey: ['buffer-ledger'] });
  };

  const renderManual = (opts: {
    title: string;
    action: 'add' | 'remove' | 'set';
    setAction: (v: 'add' | 'remove' | 'set') => void;
    amount: string;
    setAmount: (v: string) => void;
    reason: string;
    setReason: (v: string) => void;
    onSubmit: () => void;
    busy: boolean;
  }) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{opts.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Button variant={opts.action === 'add' ? 'default' : 'outline'} size="sm" onClick={() => opts.setAction('add')}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
          <Button variant={opts.action === 'remove' ? 'default' : 'outline'} size="sm" onClick={() => opts.setAction('remove')}>
            <Minus className="h-3.5 w-3.5" /> Remove
          </Button>
          <Button variant={opts.action === 'set' ? 'default' : 'outline'} size="sm" onClick={() => opts.setAction('set')}>
            <Equal className="h-3.5 w-3.5" /> Set
          </Button>
        </div>
        <div>
          <Label className="text-xs">Ποσό (€)</Label>
          <Input type="number" min="0" step="1" value={opts.amount} onChange={e => opts.setAmount(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Αιτιολογία</Label>
          <Input value={opts.reason} onChange={e => opts.setReason(e.target.value)} placeholder="π.χ. Top-up Σαβ" />
        </div>
        {opts.action === 'set' && opts.amount === '0' && (
          <p className="text-xs text-destructive">⚠ Θα μηδενιστεί όλο το buffer.</p>
        )}
        <Button onClick={opts.onSubmit} disabled={opts.busy} className="w-full" size="sm">
          {opts.busy ? 'Επεξεργασία…' : `${opts.action.toUpperCase()} €${Number(opts.amount || 0).toFixed(2)}`}
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Driver Buffer (10%)</p>
            <p className="font-heading font-bold text-3xl tabular-nums text-primary mt-1">€{pool.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Διαθέσιμο για πληρωμές drivers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Admin Buffer (5%)</p>
            <p className="font-heading font-bold text-3xl tabular-nums text-success mt-1">€{adminBal.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Πλατφόρμα · καθαρό</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {renderManual({
          title: 'Χειροκίνητη ρύθμιση Driver Buffer',
          action, setAction, amount, setAmount, reason, setReason,
          onSubmit: handleAdjust, busy,
        })}
        {renderManual({
          title: 'Χειροκίνητη ρύθμιση Admin Buffer',
          action: adminAction, setAction: setAdminAction,
          amount: adminAmount, setAmount: setAdminAmount,
          reason: adminReason, setReason: setAdminReason,
          onSubmit: handleAdminAdjust, busy: adminBusy,
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" /> Πρόσφατες κινήσεις
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(ledger.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Καμία κίνηση.</p>
          )}
          {(ledger.data ?? []).map((l: any) => {
            const amt = Number(l.amount);
            const bagLabel = l.bag === 'admin' ? 'Admin' : 'Driver';
            return (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-xs truncate">
                    <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-muted">{bagLabel}</span>
                    {l.description || l.type}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(l.created_at), 'dd MMM HH:mm', { locale: el })} · {l.type}
                  </p>
                </div>
                <span className={`font-bold tabular-nums text-sm ${amt >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {amt >= 0 ? '+' : ''}€{amt.toFixed(2)}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}


/* ============================ QUESTS ============================ */

function QuestsTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const quests = useQuery({
    queryKey: ['admin-quests'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('driver_quests')
        .select('*').order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Διαγραφή quest;')) return;
    const { error } = await (supabase as any).from('driver_quests').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Διαγράφηκε');
    qc.invalidateQueries({ queryKey: ['admin-quests'] });
  };

  const handleToggle = async (q: any) => {
    await (supabase as any).from('driver_quests').update({ is_active: !q.is_active }).eq('id', q.id);
    qc.invalidateQueries({ queryKey: ['admin-quests'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground"><Target className="h-4 w-4 inline mr-1" /> Ενεργές προκλήσεις για drivers</p>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Νέο</Button></DialogTrigger>
          <QuestDialog editing={editing} onClose={() => { setOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ['admin-quests'] }); }} />
        </Dialog>
      </div>

      {(quests.data ?? []).length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Καμία πρόκληση. Πάτα «Νέο».</CardContent></Card>
      )}

      {(quests.data ?? []).map((q: any) => {
        const used = Number(q.budget_spent);
        const cap = q.budget_cap ? Number(q.budget_cap) : null;
        const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
        return (
          <Card key={q.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{q.title}</p>
                    <Badge variant={q.is_active ? 'default' : 'outline'} className="text-[10px]">
                      {q.is_active ? 'ON' : 'OFF'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {q.target_type === 'deliveries' ? `${q.target_value} deliveries` : `€${q.target_value} κέρδη`} → <strong className="text-primary">€{Number(q.reward_amount).toFixed(2)}</strong>
                  </p>
                  {q.description && <p className="text-xs text-muted-foreground mt-1">{q.description}</p>}
                </div>
                <div className="flex gap-1">
                  <Switch checked={q.is_active} onCheckedChange={() => handleToggle(q)} />
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(q); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(q.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              {cap && (
                <div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Budget: €{used.toFixed(0)} / €{cap.toFixed(0)}</span>
                    <span>{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${pct > 90 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function QuestDialog({ editing, onClose }: { editing: any | null; onClose: () => void }) {
  const [f, setF] = useState({
    title: editing?.title ?? '',
    description: editing?.description ?? '',
    target_type: editing?.target_type ?? 'deliveries',
    target_value: editing?.target_value ?? 10,
    reward_amount: editing?.reward_amount ?? 20,
    ends_at: editing?.ends_at ? editing.ends_at.slice(0, 16) : '',
    min_rating: editing?.min_rating ?? '',
    min_tenure_days: editing?.min_tenure_days ?? '',
    vehicle_types: (editing?.vehicle_types ?? []).join(','),
    budget_cap: editing?.budget_cap ?? '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.title) return toast.error('Τίτλος υποχρεωτικός');
    setBusy(true);
    const payload: any = {
      title: f.title,
      description: f.description || null,
      target_type: f.target_type,
      target_value: Number(f.target_value),
      reward_amount: Number(f.reward_amount),
      ends_at: f.ends_at || null,
      min_rating: f.min_rating ? Number(f.min_rating) : null,
      min_tenure_days: f.min_tenure_days ? Number(f.min_tenure_days) : null,
      vehicle_types: f.vehicle_types ? f.vehicle_types.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
      budget_cap: f.budget_cap ? Number(f.budget_cap) : null,
    };
    const res = editing
      ? await (supabase as any).from('driver_quests').update(payload).eq('id', editing.id)
      : await (supabase as any).from('driver_quests').insert(payload);
    setBusy(false);
    if (res.error) return toast.error(res.error.message);
    toast.success('Αποθηκεύτηκε');
    onClose();
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{editing ? 'Επεξεργασία' : 'Νέα'} πρόκληση</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label className="text-xs">Τίτλος</Label><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="10 deliveries σε 24h" /></div>
        <div><Label className="text-xs">Περιγραφή</Label><Textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Στόχος</Label>
            <Select value={f.target_type} onValueChange={(v) => setF({ ...f, target_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deliveries">Deliveries</SelectItem>
                <SelectItem value="earnings">Κέρδη (€)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Τιμή</Label><Input type="number" value={f.target_value} onChange={e => setF({ ...f, target_value: e.target.value as any })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Reward (€)</Label><Input type="number" value={f.reward_amount} onChange={e => setF({ ...f, reward_amount: e.target.value as any })} /></div>
          <div><Label className="text-xs">Λήγει</Label><Input type="datetime-local" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} /></div>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-[11px] font-semibold flex items-center gap-1"><Shield className="h-3 w-3" /> Eligibility</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[10px]">Min rating</Label><Input type="number" step="0.1" value={f.min_rating} onChange={e => setF({ ...f, min_rating: e.target.value as any })} placeholder="4.5" /></div>
            <div><Label className="text-[10px]">Min tenure (μέρες)</Label><Input type="number" value={f.min_tenure_days} onChange={e => setF({ ...f, min_tenure_days: e.target.value as any })} placeholder="30" /></div>
          </div>
          <div><Label className="text-[10px]">Vehicle types (comma)</Label><Input value={f.vehicle_types} onChange={e => setF({ ...f, vehicle_types: e.target.value })} placeholder="motorcycle,bicycle" /></div>
        </div>
        <div><Label className="text-xs">Budget cap (€, optional)</Label><Input type="number" value={f.budget_cap} onChange={e => setF({ ...f, budget_cap: e.target.value as any })} placeholder="500" /></div>
      </div>
      <DialogFooter><Button onClick={save} disabled={busy} className="w-full">{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button></DialogFooter>
    </DialogContent>
  );
}

/* ============================ GUARANTEES ============================ */

function GuaranteesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['admin-guarantees'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('driver_guarantees').select('*').order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  const handleToggle = async (g: any) => {
    await (supabase as any).from('driver_guarantees').update({ is_active: !g.is_active }).eq('id', g.id);
    qc.invalidateQueries({ queryKey: ['admin-guarantees'] });
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Διαγραφή;')) return;
    await (supabase as any).from('driver_guarantees').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['admin-guarantees'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground"><Shield className="h-4 w-4 inline mr-1" /> Εγγυημένα κέρδη σε peak windows</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Νέο</Button></DialogTrigger>
          <GuaranteeDialog onClose={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['admin-guarantees'] }); }} />
        </Dialog>
      </div>

      {(list.data ?? []).length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Καμία εγγύηση.</CardContent></Card>
      )}

      {(list.data ?? []).map((g: any) => (
        <Card key={g.id}>
          <CardContent className="p-4 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm truncate">{g.label}</p>
                <Badge variant={g.is_active ? 'default' : 'outline'} className="text-[10px]">{g.is_active ? 'ON' : 'OFF'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                €{Number(g.min_per_hour).toFixed(2)}/h · {g.start_time?.slice(0,5)}–{g.end_time?.slice(0,5)} · acceptance ≥{g.min_acceptance_pct}%
              </p>
            </div>
            <div className="flex gap-1">
              <Switch checked={g.is_active} onCheckedChange={() => handleToggle(g)} />
              <Button size="icon" variant="ghost" onClick={() => handleDelete(g.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function GuaranteeDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ label: '', min_per_hour: 8, start_time: '19:00', end_time: '23:00', min_acceptance_pct: 80, budget_cap: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.label) return toast.error('Όνομα υποχρεωτικό');
    setBusy(true);
    const { error } = await (supabase as any).from('driver_guarantees').insert({
      label: f.label,
      min_per_hour: Number(f.min_per_hour),
      start_time: f.start_time,
      end_time: f.end_time,
      min_acceptance_pct: Number(f.min_acceptance_pct),
      budget_cap: f.budget_cap ? Number(f.budget_cap) : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Αποθηκεύτηκε');
    onClose();
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Νέα εγγύηση κερδών</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label className="text-xs">Όνομα</Label><Input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} placeholder="Παρ-Σαβ Peak" /></div>
        <div><Label className="text-xs">Min €/ώρα</Label><Input type="number" value={f.min_per_hour} onChange={e => setF({ ...f, min_per_hour: e.target.value as any })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Από</Label><Input type="time" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} /></div>
          <div><Label className="text-xs">Έως</Label><Input type="time" value={f.end_time} onChange={e => setF({ ...f, end_time: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Min acceptance %</Label><Input type="number" value={f.min_acceptance_pct} onChange={e => setF({ ...f, min_acceptance_pct: e.target.value as any })} /></div>
          <div><Label className="text-xs">Budget cap (€)</Label><Input type="number" value={f.budget_cap} onChange={e => setF({ ...f, budget_cap: e.target.value as any })} /></div>
        </div>
      </div>
      <DialogFooter><Button onClick={save} disabled={busy} className="w-full">{busy ? '…' : 'Αποθήκευση'}</Button></DialogFooter>
    </DialogContent>
  );
}

/* ============================ SURGE ============================ */

function SurgeTab() {
  const qc = useQueryClient();
  const zones = useQuery({
    queryKey: ['surge-zones'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('demand_zones')
        .select('id, name, multiplier, is_active, auto_surge, surge_ends_at, radius_km').order('name');
      return data ?? [];
    },
  });

  const update = async (id: string, patch: any) => {
    await (supabase as any).from('demand_zones').update(patch).eq('id', id);
    qc.invalidateQueries({ queryKey: ['surge-zones'] });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground"><Flame className="h-4 w-4 inline mr-1" /> Multipliers ανά ζώνη — αλλάζει live τα κέρδη οδηγών στη ζώνη</p>
      {(zones.data ?? []).length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν ζώνες. Πρόσθεσε από το Surge Map.</CardContent></Card>
      )}
      {(zones.data ?? []).map((z: any) => (
        <Card key={z.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{z.name}</p>
                <p className="text-xs text-muted-foreground">{z.radius_km}km radius</p>
              </div>
              <Switch checked={z.is_active} onCheckedChange={(v) => update(z.id, { is_active: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <Label className="text-xs">Multiplier (×)</Label>
                <Input type="number" step="0.1" min="1" max="3" defaultValue={z.multiplier}
                  onBlur={(e) => update(z.id, { multiplier: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={z.auto_surge} onCheckedChange={(v) => update(z.id, { auto_surge: v })} />
                <Label className="text-xs">Auto surge (low supply)</Label>
              </div>
            </div>
            {Number(z.multiplier) > 1 && (
              <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px]">
                <Flame className="h-3 w-3 mr-1" /> Surge {z.multiplier}× ενεργό
              </Badge>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ============================ STREAKS ============================ */

function StreaksTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['admin-streaks'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('streak_bonuses').select('*').order('consecutive_accepts');
      return data ?? [];
    },
  });

  const handleToggle = async (s: any) => {
    await (supabase as any).from('streak_bonuses').update({ is_active: !s.is_active }).eq('id', s.id);
    qc.invalidateQueries({ queryKey: ['admin-streaks'] });
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Διαγραφή;')) return;
    await (supabase as any).from('streak_bonuses').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['admin-streaks'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground"><Trophy className="h-4 w-4 inline mr-1" /> Bonus για συνεχόμενα accepts</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Νέο</Button></DialogTrigger>
          <StreakDialog onClose={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['admin-streaks'] }); }} />
        </Dialog>
      </div>
      {(list.data ?? []).length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Κανένα streak bonus.</CardContent></Card>
      )}
      {(list.data ?? []).map((s: any) => (
        <Card key={s.id}>
          <CardContent className="p-4 flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">{s.label}</p>
                <Badge variant={s.is_active ? 'default' : 'outline'} className="text-[10px]">{s.is_active ? 'ON' : 'OFF'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {s.consecutive_accepts} accepts σε {s.window_hours}h → €{Number(s.reward_amount).toFixed(2)}
              </p>
            </div>
            <div className="flex gap-1">
              <Switch checked={s.is_active} onCheckedChange={() => handleToggle(s)} />
              <Button size="icon" variant="ghost" onClick={() => handleDelete(s.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StreakDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ label: '', consecutive_accepts: 5, reward_amount: 5, window_hours: 4, budget_cap: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.label) return toast.error('Όνομα υποχρεωτικό');
    setBusy(true);
    const { error } = await (supabase as any).from('streak_bonuses').insert({
      label: f.label,
      consecutive_accepts: Number(f.consecutive_accepts),
      reward_amount: Number(f.reward_amount),
      window_hours: Number(f.window_hours),
      budget_cap: f.budget_cap ? Number(f.budget_cap) : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Αποθηκεύτηκε');
    onClose();
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Νέο streak bonus</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label className="text-xs">Όνομα</Label><Input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} placeholder="5-streak weekend" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">Accepts</Label><Input type="number" value={f.consecutive_accepts} onChange={e => setF({ ...f, consecutive_accepts: e.target.value as any })} /></div>
          <div><Label className="text-xs">Window (h)</Label><Input type="number" value={f.window_hours} onChange={e => setF({ ...f, window_hours: e.target.value as any })} /></div>
          <div><Label className="text-xs">Reward (€)</Label><Input type="number" value={f.reward_amount} onChange={e => setF({ ...f, reward_amount: e.target.value as any })} /></div>
        </div>
        <div><Label className="text-xs">Budget cap (€)</Label><Input type="number" value={f.budget_cap} onChange={e => setF({ ...f, budget_cap: e.target.value as any })} /></div>
      </div>
      <DialogFooter><Button onClick={save} disabled={busy} className="w-full">{busy ? '…' : 'Αποθήκευση'}</Button></DialogFooter>
    </DialogContent>
  );
}

/* ============================ DISTRIBUTE (legacy ad-hoc) ============================ */

function DistributeTab() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('50');
  const [mode, setMode] = useState<'equal' | 'top' | 'surge'>('equal');
  const [topN, setTopN] = useState('10');
  const [zoneId, setZoneId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const treasury = useQuery({
    queryKey: ['admin-treasury-buffer'],
    refetchInterval: 10000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('admin_treasury')
        .select('platform_pool').eq('id', 1).maybeSingle();
      return data ?? { platform_pool: 0 };
    },
  });
  const pool = Number(treasury.data?.platform_pool ?? 0);

  const zones = useQuery({
    queryKey: ['demand-zones-buffer'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('demand_zones').select('id, name').eq('is_active', true).order('name');
      return data ?? [];
    },
  });

  const history = useQuery({
    queryKey: ['buffer-distributions'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await (supabase as any).from('basket_distributions')
        .select('id, total_amount, recipient_count, notes, snapshot, created_at')
        .order('created_at', { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const handleDistribute = async () => {
    const amt = Number(amount);
    if (amt <= 0) return toast.error('Δώσε ποσό > 0');
    if (amt > pool) return toast.error(`Το buffer έχει μόνο €${pool.toFixed(2)} διαθέσιμα`);
    if (mode === 'surge' && !zoneId) return toast.error('Διάλεξε ζώνη');
    setBusy(true);
    const { data, error } = await (supabase as any).rpc('admin_distribute_buffer', {
      p_amount: amt, p_mode: mode, p_top_n: Number(topN) || 10,
      p_zone_id: mode === 'surge' ? zoneId : null, p_note: note || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Μοιράστηκαν €${data.total} σε ${data.recipients} (€${data.per_driver} έκαστος)`);
    setNote('');
    qc.invalidateQueries({ queryKey: ['buffer-distributions'] });
    qc.invalidateQueries({ queryKey: ['admin-treasury-buffer'] });
  };


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" /> Ad-hoc διανομή</span>
            <span className="text-xs font-normal text-muted-foreground">Διαθέσιμο: <strong className="text-primary tabular-nums">€{pool.toFixed(2)}</strong></span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Ποσό (€)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Κανόνας</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equal">Equal split (ενεργοί 7d)</SelectItem>
                  <SelectItem value="top">Top earners</SelectItem>
                  <SelectItem value="surge">Surge zone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {mode === 'top' && (
            <div><Label className="text-xs">Top N</Label><Input type="number" value={topN} onChange={e => setTopN(e.target.value)} /></div>
          )}
          {mode === 'surge' && (
            <div>
              <Label className="text-xs">Ζώνη</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger><SelectValue placeholder="Διάλεξε" /></SelectTrigger>
                <SelectContent>
                  {(zones.data ?? []).map((z: any) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label className="text-xs">Σημείωση</Label><Input value={note} onChange={e => setNote(e.target.value)} placeholder="π.χ. Bonus weekend" /></div>
          <Button onClick={handleDistribute} disabled={busy} className="w-full">{busy ? 'Διανομή…' : `Διανομή €${Number(amount || 0).toFixed(2)}`}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Πρόσφατες διανομές</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(history.data ?? []).length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Καμία.</p>}
          {(history.data ?? []).map((d: any) => (
            <div key={d.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium tabular-nums">€{Number(d.total_amount).toFixed(2)} → {d.recipient_count} drivers</p>
              <p className="text-[11px] text-muted-foreground">
                {format(new Date(d.created_at), 'dd MMM HH:mm', { locale: el })}
                {d.snapshot?.mode && <> · {d.snapshot.mode}</>}
                {d.notes && <> · {d.notes}</>}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
