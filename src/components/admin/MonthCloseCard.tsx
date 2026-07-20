import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarClock, Archive, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fmt = (n: number | null | undefined) => `€${Number(n ?? 0).toFixed(2)}`;

export default function MonthCloseCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: reports } = useQuery({
    queryKey: ['monthly-reports'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('monthly_reports')
        .select('*')
        .order('period_start', { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; period_start: string; period_end: string;
        admin_earned: number; platform_earned: number; driver_topup_total: number;
        orders_count: number; delivered_revenue: number; closed_at: string;
      }>;
    },
  });

  const closeMonth = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc('admin_close_month', { p_period_start: null });
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Μήνας έκλεισε — πορτοφόλι admin & platform pool στο 0');
      qc.invalidateQueries({ queryKey: ['monthly-reports'] });
      qc.invalidateQueries({ queryKey: ['admin-treasury'] });
    }
  };

  const deleteAllStats = async () => {
    setBusy(true);
    const { error } = await (supabase as any)
      .from('monthly_reports')
      .delete()
      .gte('period_start', '1900-01-01');
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Όλα τα μηνιαία στατιστικά διαγράφηκαν');
      qc.invalidateQueries({ queryKey: ['monthly-reports'] });
    }
  };

  const currentMonth = format(new Date(), 'MMMM yyyy');

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-purple-500" />
            Μηνιαίο Κλείσιμο
          </CardTitle>
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="default" className="gap-2">
                  <Archive className="h-3.5 w-3.5" />
                  Κλείσιμο {currentMonth}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Κλείσιμο μήνα — {currentMonth};</AlertDialogTitle>
                  <AlertDialogDescription>
                    Αρχειοθετεί τα κέρδη του μήνα και μηδενίζει το <b>Admin Balance</b> και
                    το <b>Platform Pool</b>. Τα lifetime totals και το ιστορικό παραμένουν.
                    <br /><br />
                    Δεν επηρεάζει: store wallets, driver wallets, παραγγελίες.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Άκυρο</AlertDialogCancel>
                  <AlertDialogAction onClick={closeMonth} disabled={busy}>
                    {busy ? 'Κλείσιμο…' : 'Ναι, κλείσε τον μήνα'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="gap-2">
                  <Trash2 className="h-3.5 w-3.5" />
                  Διαγραφή όλων
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Διαγραφή όλων των μηνιαίων στατιστικών;</AlertDialogTitle>
                  <AlertDialogDescription>
                    Διαγράφει όλο το αρχείο μηνιαίων κλεισιμάτων (snapshot, admin/platform earned, top-ups, παραγγελίες, τζίρος). Η ενέργεια <b>δεν αναιρείται</b>.
                    <br /><br />
                    Δεν επηρεάζει τρέχοντα balances, παραγγελίες ή πορτοφόλια.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Άκυρο</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteAllStats} disabled={busy}>
                    {busy ? 'Διαγραφή…' : 'Ναι, διέγραψέ τα όλα'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {reports && reports.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Περίοδος</TableHead>
                  <TableHead className="text-right">Admin</TableHead>
                  <TableHead className="text-right">Platform</TableHead>
                  <TableHead className="text-right">Top-ups</TableHead>
                  <TableHead className="text-right">Παραγγελίες</TableHead>
                  <TableHead className="text-right">Τζίρος</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{format(new Date(r.period_start), 'MMM yyyy')}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-600">{fmt(r.admin_earned)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.platform_earned)}</TableCell>
                    <TableCell className="text-right tabular-nums text-blue-600">{fmt(r.driver_topup_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.orders_count}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.delivered_revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Κανένα κλείσιμο ακόμα. Πάτησε «Κλείσιμο» στο τέλος του μήνα.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
