import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import MonthCloseCard from './MonthCloseCard';
import CustomOrderDialog from './CustomOrderDialog';
import PoolHealthDashboard from './PoolHealthDashboard';
import {
  TrendingUp, TrendingDown, Activity, ArrowDownCircle, Wallet,
  CheckCircle2, Loader2, Search, Download, AlertCircle, Info,
} from 'lucide-react';

const fmt = (n: number | null | undefined) => `€${Number(n ?? 0).toFixed(2)}`;

type LedgerRow = {
  id: string;
  type: string;
  bag: string;
  amount: number;
  description: string | null;
  order_id: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  admin_fee: 'Admin fee (5%)',
  platform_fee: 'Platform commission',
  driver_topup: 'Driver top-up',
  cash_settled: 'Cash συμψηφισμός',
  month_close: 'Κλείσιμο μήνα',
  manual_reset: 'Χειροκίνητο reset',
};

/**
 * Unified ledger replacement for the old "Money Bags" UI.
 *
 * One source of truth: every row in `admin_treasury_ledger`. No buckets,
 * no manual resets per bag — just a clean income / outflow log with totals,
 * filters, CSV export, and a separate cash-settlement queue.
 */
export default function LedgerPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [days, setDays] = useState<string>('30');
  const [bulkSettling, setBulkSettling] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);

  const { data: ledger, isLoading } = useQuery({
    queryKey: ['admin-ledger', days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - Number(days));
      const { data, error } = await (supabase as any)
        .from('admin_treasury_ledger')
        .select('*')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    refetchInterval: 30_000,
  });

  const { data: cashDebts } = useQuery({
    queryKey: ['ledger-cash-debts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('driver_cash_debts')
        .select('*')
        .eq('settled', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; driver_id: string; cash_collected: number;
        amount_owed: number; created_at: string;
      }>;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['ledger-driver-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name').eq('role', 'driver');
      if (error) throw error;
      const m = new Map<string, string>();
      (data ?? []).forEach((p: any) => m.set(p.user_id, p.full_name ?? ''));
      return m;
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel('ledger-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_treasury_ledger' },
        () => qc.invalidateQueries({ queryKey: ['admin-ledger'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_cash_debts' },
        () => qc.invalidateQueries({ queryKey: ['ledger-cash-debts'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtered = useMemo(() => {
    let rows = ledger ?? [];
    if (typeFilter !== 'all') rows = rows.filter(r => r.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.order_id ?? '').toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [ledger, typeFilter, search]);

  const totals = useMemo(() => {
    const rows = ledger ?? [];
    let inflow = 0, outflow = 0;
    rows.forEach(r => {
      const amt = Number(r.amount) || 0;
      if (amt >= 0) inflow += amt; else outflow += Math.abs(amt);
    });
    return { inflow, outflow, net: inflow - outflow, count: rows.length };
  }, [ledger]);

  const types = useMemo(() => {
    const set = new Set<string>();
    (ledger ?? []).forEach(r => set.add(r.type));
    return Array.from(set);
  }, [ledger]);

  const settleAll = async () => {
    setBulkSettling(true);
    const { data, error } = await (supabase as any).rpc('admin_settle_all_driver_cash');
    setBulkSettling(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Συμψηφίστηκαν ${data?.settled ?? 0} χρέη (${fmt(Number(data?.total ?? 0))})`);
    qc.invalidateQueries({ queryKey: ['ledger-cash-debts'] });
    qc.invalidateQueries({ queryKey: ['admin-ledger'] });
  };

  const settleOne = async (id: string) => {
    setSettling(id);
    const { error } = await (supabase as any).rpc('admin_settle_driver_cash', { p_debt_id: id });
    setSettling(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Cash settled');
    qc.invalidateQueries({ queryKey: ['ledger-cash-debts'] });
  };

  const exportCsv = () => {
    const rows = filtered;
    const header = ['date', 'type', 'amount', 'description', 'order_id'];
    const lines = [header.join(',')];
    rows.forEach(r => {
      lines.push([
        new Date(r.created_at).toISOString(),
        r.type,
        Number(r.amount).toFixed(2),
        `"${(r.description ?? '').replace(/"/g, '""')}"`,
        r.order_id ?? '',
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ledger-${days}d-${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const driverName = (id: string) => profiles?.get(id) || `${id.slice(0, 6)}…`;

  return (
    <div className="space-y-4">
      <div className="admin-section-header flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-section-title">Οικονομικά · Ledger</h2>
          <p className="admin-section-sub mt-0.5">
            Ενιαίο ημερολόγιο κινήσεων — κάθε ευρώ που μπαίνει ή βγαίνει από την πλατφόρμα, σε μία γραμμή.
          </p>
        </div>
        <CustomOrderDialog />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"><Activity className="h-3.5 w-3.5 mr-1" />Επισκόπηση</TabsTrigger>
          <TabsTrigger value="pool"><TrendingUp className="h-3.5 w-3.5 mr-1" />Pool Health</TabsTrigger>
          <TabsTrigger value="ledger"><Wallet className="h-3.5 w-3.5 mr-1" />Κινήσεις</TabsTrigger>
          <TabsTrigger value="cash"><ArrowDownCircle className="h-3.5 w-3.5 mr-1" />Cash συμψηφισμοί
            {cashDebts && cashDebts.length > 0 && (
              <Badge className="ml-1.5 h-4 px-1.5 bg-warning/20 text-warning border-warning/30">{cashDebts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="month">Κλείσιμο μήνα</TabsTrigger>
        </TabsList>

        <TabsContent value="pool" className="m-0">
          <PoolHealthDashboard />
        </TabsContent>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4 m-0">
          <Card className="border-primary/20 bg-primary/[0.02]">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="text-[13px] leading-relaxed">
                <p className="font-heading font-semibold mb-1">Πώς δουλεύει</p>
                <p className="text-muted-foreground">
                  Κάθε ολοκληρωμένη παραγγελία γράφει αυτόματα γραμμές στο ledger:
                  <b className="text-foreground"> Admin fee 5%</b>, <b className="text-foreground">Platform commission 10%</b>,
                  driver top-ups, cash συμψηφισμοί. Καμία χειροκίνητη ενέργεια — απλώς διαβάζεις την κίνηση.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-heading">Έσοδα ({days}η)</p>
                </div>
                <p className="text-2xl font-heading font-extrabold tabular-nums text-emerald-600">{fmt(totals.inflow)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-heading">Έξοδα ({days}η)</p>
                </div>
                <p className="text-2xl font-heading font-extrabold tabular-nums text-destructive">{fmt(totals.outflow)}</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-primary">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="h-4 w-4 text-primary" />
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-heading">Καθαρό ({days}η)</p>
                </div>
                <p className="text-2xl font-heading font-extrabold tabular-nums">{fmt(totals.net)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{totals.count} κινήσεις</p>
              </CardContent>
            </Card>
          </div>

          {cashDebts && cashDebts.length > 0 && (
            <Card className="border-warning/40 bg-warning/[0.04]">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-sm">{cashDebts.length} εκκρεμή cash συμψηφισμοί</p>
                  <p className="text-xs text-muted-foreground">
                    Σύνολο: {fmt(cashDebts.reduce((s, d) => s + Number(d.amount_owed), 0))}
                  </p>
                </div>
                <Button size="sm" onClick={settleAll} disabled={bulkSettling} className="gap-1.5">
                  {bulkSettling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Settle all
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* LEDGER TABLE */}
        <TabsContent value="ledger" className="m-0">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-heading text-base">Κινήσεις</CardTitle>
                <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />Export CSV
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Αναζήτηση περιγραφής / order id…"
                    className="pl-8 h-9"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Όλοι οι τύποι</SelectItem>
                    {types.map(t => (
                      <SelectItem key={t} value={t}>{TYPE_LABEL[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 ημέρες</SelectItem>
                    <SelectItem value="30">30 ημέρες</SelectItem>
                    <SelectItem value="90">90 ημέρες</SelectItem>
                    <SelectItem value="365">1 έτος</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {isLoading ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ημερομηνία</TableHead>
                      <TableHead>Τύπος</TableHead>
                      <TableHead className="text-right">Ποσό</TableHead>
                      <TableHead className="hidden md:table-cell">Περιγραφή</TableHead>
                      <TableHead className="hidden lg:table-cell">Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => {
                      const amt = Number(r.amount);
                      const positive = amt >= 0;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(r.created_at), 'dd MMM, HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-heading text-[10px] uppercase">
                              {TYPE_LABEL[r.type] ?? r.type}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-bold ${positive ? 'text-emerald-600' : 'text-destructive'}`}>
                            {positive ? '+' : ''}{fmt(amt)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs max-w-[280px] truncate">{r.description ?? '—'}</TableCell>
                          <TableCell className="hidden lg:table-cell text-xs font-mono text-muted-foreground">
                            {r.order_id ? r.order_id.slice(0, 8) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!filtered.length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Καμία κίνηση</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CASH SETTLEMENTS */}
        <TabsContent value="cash" className="m-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-heading text-base">Εκκρεμή Cash</CardTitle>
              {cashDebts && cashDebts.length > 0 && (
                <Button size="sm" onClick={settleAll} disabled={bulkSettling} className="gap-1.5">
                  {bulkSettling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Settle all
                </Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {!cashDebts || cashDebts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Όλα τα μετρητά έχουν συμψηφιστεί.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Οδηγός</TableHead>
                      <TableHead className="text-right">Cash</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="hidden md:table-cell">Πότε</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashDebts.map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{driverName(d.driver_id)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(d.cash_collected)}</TableCell>
                        <TableCell className="text-right tabular-nums font-bold">{fmt(d.amount_owed)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                          {format(new Date(d.created_at), 'dd MMM, HH:mm')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => settleOne(d.id)} disabled={settling === d.id} className="gap-1 h-8">
                            {settling === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            Settle
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="month" className="m-0">
          <MonthCloseCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
