import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Search } from 'lucide-react';
import ReconciliationPanel from './ReconciliationPanel';

type Tx = {
  id: string;
  wallet_kind: string;
  wallet_owner_id: string | null;
  amount: number;
  type: string;
  order_id: string | null;
  balance_after: number | null;
  description: string | null;
  created_at: string;
};

const KIND_LABELS: Record<string, string> = {
  driver: 'Οδηγός', store: 'Κατάστημα', customer: 'Πελάτης', admin: 'Admin', basket: 'Driver Basket',
};

export default function LedgerExplorer() {
  const [kind, setKind] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-ledger', kind],
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = (supabase as any).from('transactions').select('*').order('created_at', { ascending: false }).limit(300);
      if (kind !== 'all') q = q.eq('wallet_kind', kind);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
  });

  const totals = (data ?? []).reduce(
    (acc, t) => {
      const a = Number(t.amount);
      if (a >= 0) acc.in += a; else acc.out += -a;
      return acc;
    },
    { in: 0, out: 0 },
  );

  const filtered = (data ?? []).filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.type.toLowerCase().includes(s) ||
      (t.description ?? '').toLowerCase().includes(s) ||
      (t.wallet_owner_id ?? '').toLowerCase().includes(s) ||
      (t.order_id ?? '').toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-3">
      <ReconciliationPanel />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Κινήσεις (τελευταίες 300)" value={String(data?.length ?? 0)} tone="text-foreground" />
        <SummaryCard label="Σύνολο εισροών" value={`€${totals.in.toFixed(2)}`} tone="text-success" />
        <SummaryCard label="Σύνολο εκροών" value={`€${totals.out.toFixed(2)}`} tone="text-destructive" />
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3">
          <CardTitle className="text-base">Ενιαίο καθολικό κινήσεων</CardTitle>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Αναζήτηση…" className="pl-8 h-9" />
            </div>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Όλα τα ταμεία</SelectItem>
                <SelectItem value="driver">Οδηγοί</SelectItem>
                <SelectItem value="store">Καταστήματα</SelectItem>
                <SelectItem value="customer">Πελάτες</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="basket">Driver Basket</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ώρα</TableHead>
                    <TableHead>Ταμείο</TableHead>
                    <TableHead>Τύπος</TableHead>
                    <TableHead className="text-right">Ποσό</TableHead>
                    <TableHead className="text-right">Υπόλοιπο μετά</TableHead>
                    <TableHead>Περιγραφή</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Καμία κίνηση</TableCell></TableRow>
                  ) : filtered.map(t => {
                    const a = Number(t.amount);
                    const positive = a >= 0;
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(t.created_at), 'dd/MM HH:mm:ss')}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10.5px]">{KIND_LABELS[t.wallet_kind] ?? t.wallet_kind}</Badge></TableCell>
                        <TableCell className="text-xs">{t.type}</TableCell>
                        <TableCell className={`text-right font-mono text-xs font-semibold ${positive ? 'text-success' : 'text-destructive'}`}>
                          <span className="inline-flex items-center gap-1 justify-end">
                            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {positive ? '+' : ''}{a.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {t.balance_after != null ? `€${Number(t.balance_after).toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{t.description ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-heading font-bold mt-1 ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
