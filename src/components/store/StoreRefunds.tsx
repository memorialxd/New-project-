import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Receipt } from 'lucide-react';
import { format } from 'date-fns';

interface StoreRefundsProps { storeId: string; }

interface RefundRow {
  id: string;
  amount: number;
  reason: string | null;
  refund_type: string;
  created_at: string;
  order_id: string;
}

export function StoreRefunds({ storeId }: StoreRefundsProps) {
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fetch this store's order ids first
      const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('store_id', storeId);
      const ids = (orders ?? []).map(o => o.id);
      if (!ids.length) {
        if (!cancelled) { setRefunds([]); setLoading(false); }
        return;
      }
      const { data } = await supabase
        .from('refunds')
        .select('id, amount, reason, refund_type, created_at, order_id')
        .in('order_id', ids)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!cancelled) {
        setRefunds((data ?? []) as RefundRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storeId]);

  const total = refunds.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" /> Επιστροφές χρημάτων
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Συνολικές επιστροφές</span>
          <span className="font-heading font-bold text-destructive">€{total.toFixed(2)}</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Παραγγελία</TableHead>
                <TableHead>Ποσό</TableHead>
                <TableHead>Τύπος</TableHead>
                <TableHead>Λόγος</TableHead>
                <TableHead>Ημερομηνία</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Φόρτωση...</TableCell></TableRow>
              )}
              {!loading && refunds.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">#{r.order_id.slice(0, 8)}</TableCell>
                  <TableCell className="font-bold text-destructive">€{Number(r.amount).toFixed(2)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{r.refund_type}</Badge></TableCell>
                  <TableCell className="text-sm max-w-xs truncate">{r.reason || '—'}</TableCell>
                  <TableCell className="text-xs">{format(new Date(r.created_at), 'dd MMM, HH:mm')}</TableCell>
                </TableRow>
              ))}
              {!loading && !refunds.length && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Καμία επιστροφή</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
