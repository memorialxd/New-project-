import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import { Gift, TrendingUp, Wallet, Play, Trophy, Award, Sparkles, Clock, Plus, Minus } from 'lucide-react';

const KIND_META: Record<string, { label: string; icon: any; tone: string }> = {
  top_drivers:  { label: 'Top οδηγοί', icon: Trophy, tone: 'text-warning' },
  milestone:    { label: 'Ορόσημα παραδόσεων', icon: Award, tone: 'text-info' },
  tenure:       { label: 'Παλαιότητα', icon: Clock, tone: 'text-primary' },
  performance:  { label: 'Απόδοση', icon: Sparkles, tone: 'text-success' },
  manual:       { label: 'Χειροκίνητη', icon: Gift, tone: 'text-muted-foreground' },
};

export default function BasketDashboard() {
  const qc = useQueryClient();
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  const adjustBasket = async (sign: 1 | -1) => {
    const n = Number(adjAmount);
    if (!n || n <= 0) { toast.error('Δώσε ποσό > 0'); return; }
    setAdjBusy(true);
    const { error } = await (supabase as any).rpc('admin_adjust_basket', {
      _amount: sign * n,
      _note: adjNote || (sign > 0 ? 'Admin deposit' : 'Admin withdrawal'),
    });
    setAdjBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(sign > 0 ? `+€${n.toFixed(2)} στο Basket` : `−€${n.toFixed(2)} από το Basket`);
    setAdjAmount(''); setAdjNote('');
    qc.invalidateQueries({ queryKey: ['basket-health'] });
    qc.invalidateQueries({ queryKey: ['basket-distributions-recent'] });
  };

  const health = useQuery({
    queryKey: ['basket-health'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('basket_health').select('*').maybeSingle();
      if (error) throw error;
      return data as {
        current_balance: number; lifetime_in: number; lifetime_distributed: number;
        distributed_7d: number; distributed_30d: number; last_distribution_at: string | null;
      } | null;
    },
  });

  const rules = useQuery({
    queryKey: ['basket-rules'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('basket_distribution_rules').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  const recent = useQuery({
    queryKey: ['basket-distributions-recent'],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('basket_distributions').select('*').order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  const toggleRule = async (id: string, active: boolean) => {
    const { error } = await (supabase as any).from('basket_distribution_rules').update({ is_active: active }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(active ? 'Κανόνας ενεργός' : 'Κανόνας ανενεργός'); qc.invalidateQueries({ queryKey: ['basket-rules'] }); }
  };

  const runRule = async (id: string, name: string) => {
    if (!confirm(`Εκτέλεση διανομής: "${name}"; Αυτή η ενέργεια θα χρεώσει το Driver Basket.`)) return;
    const { error } = await (supabase as any).rpc('run_basket_distribution', { _rule_id: id });
    if (error) toast.error(error.message);
    else {
      toast.success('Η διανομή εκτελέστηκε');
      qc.invalidateQueries({ queryKey: ['basket-health'] });
      qc.invalidateQueries({ queryKey: ['basket-distributions-recent'] });
      qc.invalidateQueries({ queryKey: ['basket-rules'] });
    }
  };

  const h = health.data;

  return (
    <div className="space-y-3">
      {/* Hero strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Wallet} tone="text-primary toneBg-primary"
          label="Driver Basket τώρα"
          value={h ? `€${Number(h.current_balance).toFixed(2)}` : '—'}
          loading={health.isLoading}
        />
        <StatCard
          icon={TrendingUp} tone="text-success"
          label="Σύνολο εισροών (lifetime)"
          value={h ? `€${Number(h.lifetime_in).toFixed(2)}` : '—'}
          loading={health.isLoading}
        />
        <StatCard
          icon={Gift} tone="text-info"
          label="Διανομές 7 ημερών"
          value={h ? `€${Number(h.distributed_7d).toFixed(2)}` : '—'}
          loading={health.isLoading}
        />
        <StatCard
          icon={Award} tone="text-warning"
          label="Διανομές 30 ημερών"
          value={h ? `€${Number(h.distributed_30d).toFixed(2)}` : '—'}
          loading={health.isLoading}
        />
      </div>

      {/* Rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Κανόνες διανομής</CardTitle>
          <p className="text-xs text-muted-foreground">
            Το Driver Basket μπορεί μόνο να αυξάνεται από παραγγελίες. Διανομές χρεώνουν το ταμείο και πιστώνουν οδηγούς.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {rules.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (rules.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν κανόνες ακόμη.</p>
          ) : (
            <div className="divide-y divide-border">
              {(rules.data ?? []).map((r: any) => {
                const meta = KIND_META[r.kind] ?? KIND_META.manual;
                const Icon = meta.icon;
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors">
                    <div className={`h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 ${meta.tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">{r.name}</p>
                        <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                        <Badge variant="outline" className="text-[10px]">{r.schedule}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.amount_mode === 'flat_total' && `€${Number(r.amount_value).toFixed(2)} συνολικό pot`}
                        {r.amount_mode === 'percent_of_basket' && `${Number(r.amount_value).toFixed(1)}% του Basket`}
                        {r.amount_mode === 'per_recipient' && `€${Number(r.amount_value).toFixed(2)} ανά οδηγό`}
                        {r.last_run_at && ` · Τελευταία: ${format(new Date(r.last_run_at), 'dd/MM HH:mm')}`}
                      </p>
                    </div>
                    <Switch checked={!!r.is_active} onCheckedChange={(v) => toggleRule(r.id, v)} />
                    <Button size="sm" variant="outline" onClick={() => runRule(r.id, r.name)} disabled={!r.is_active}>
                      <Play className="h-3.5 w-3.5 mr-1" /> Εκτέλεση
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual basket adjustment */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Χειροκίνητη ρύθμιση Basket</CardTitle>
          <p className="text-xs text-muted-foreground">Πρόσθεσε ή αφαίρεσε χρήματα από το ταμείο. Κάθε ενέργεια καταγράφεται στο ledger.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow min-w-[140px]">
              <label className="text-[11px] text-muted-foreground">Ποσό (€)</label>
              <Input type="number" step="0.01" min="0" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="grow min-w-[200px]">
              <label className="text-[11px] text-muted-foreground">Σημείωση</label>
              <Input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="π.χ. εισφορά, προσαρμογή…" />
            </div>
            <Button onClick={() => adjustBasket(1)} disabled={adjBusy} className="bg-success hover:bg-success/90 text-success-foreground">
              <Plus className="h-4 w-4 mr-1" /> Κατάθεση
            </Button>
            <Button onClick={() => adjustBasket(-1)} disabled={adjBusy} variant="destructive">
              <Minus className="h-4 w-4 mr-1" /> Ανάληψη
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent distributions */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Πρόσφατες διανομές</CardTitle></CardHeader>
        <CardContent className="p-0">
          {recent.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (recent.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν διανομές ακόμη.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Ώρα</TableHead><TableHead>Παραλήπτες</TableHead>
                  <TableHead className="text-right">Σύνολο</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(recent.data ?? []).map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{format(new Date(d.created_at), 'dd/MM HH:mm')}</TableCell>
                      <TableCell className="text-xs">{d.recipient_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-success">€{Number(d.total_amount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, tone, label, value, loading }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${tone}`} />
        </div>
        {loading ? <Skeleton className="h-7 w-24" /> : <p className="text-2xl font-heading font-bold">{value}</p>}
      </CardContent>
    </Card>
  );
}
