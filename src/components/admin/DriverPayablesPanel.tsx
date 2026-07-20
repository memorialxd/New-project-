import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Wallet, Search, RotateCcw, AlertTriangle, Loader2, FileDown, Banknote, HandCoins, FileText } from 'lucide-react';

const VAT_RATE = 0.24;

/**
 * Per-driver payables overview.
 * - Available + pending balance per driver (what admin owes them).
 * - Pending shift cash (what driver owes admin from cash orders).
 * - Per-row "Reset wallet 0" + "Reset shift cash 0".
 * - Bulk reset all driver wallets.
 * - CSV export.
 */
export default function DriverPayablesPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [walletTarget, setWalletTarget] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [cashTarget, setCashTarget] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [lifetimeTarget, setLifetimeTarget] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLifetimeOpen, setBulkLifetimeOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-driver-payables'],
    queryFn: async () => {
      const [{ data: profiles, error: e1 }, { data: wallets, error: e2 }, { data: states, error: e3 }, { data: dprofiles, error: e4 }] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name, role').eq('role', 'driver'),
        supabase.from('driver_wallets').select('driver_id, available_balance, pending_balance, total_withdrawn, updated_at'),
        (supabase as any).from('driver_state').select('driver_id, shift_cash_balance, shift_started_at'),
        (supabase as any).from('driver_profiles').select('user_id, driver_code, is_active'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      const wmap = new Map((wallets ?? []).map((w: any) => [w.driver_id, w]));
      const smap = new Map((states ?? []).map((s: any) => [s.driver_id, s]));
      const dmap = new Map((dprofiles ?? []).map((d: any) => [d.user_id, d]));
      return (profiles ?? []).map((p: any) => {
        const w: any = wmap.get(p.user_id);
        const s: any = smap.get(p.user_id);
        const d: any = dmap.get(p.user_id);
        return {
          id: p.user_id as string,
          name: (p.full_name as string) || (d?.driver_code as string) || p.user_id.slice(0, 8),
          driver_code: d?.driver_code as string | undefined,
          is_active: d?.is_active as boolean | undefined,
          on_shift: !!s?.shift_started_at,
          available: Number(w?.available_balance ?? 0),
          pending: Number(w?.pending_balance ?? 0),
          shift_cash: Number(s?.shift_cash_balance ?? 0),
          withdrawn: Number(w?.total_withdrawn ?? 0),
          updated_at: w?.updated_at as string | undefined,
        };
      });
    },
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const needle = q.trim().toLowerCase();
    const f = needle
      ? rows.filter(r => r.name.toLowerCase().includes(needle) || (r.driver_code ?? '').toLowerCase().includes(needle))
      : rows;
    return [...f].sort((a, b) => (b.available + b.pending) - (a.available + a.pending));
  }, [data, q]);

  const totals = useMemo(() => {
    const rows = data ?? [];
    const owe = rows.reduce((s, r) => s + r.available + r.pending, 0);
    const cash = rows.reduce((s, r) => s + r.shift_cash, 0);
    const drivers = rows.length;
    const onShift = rows.filter(r => r.on_shift).length;
    return { owe, cash, drivers, onShift };
  }, [data]);

  const exportCsv = () => {
    const rows = filtered;
    const header = ['Οδηγός', 'Κωδικός', 'Διαθέσιμο (€)', 'Εκκρεμές (€)', 'Σύνολο πληρωμής (€)', 'Μετρητά βάρδιας (€)', 'Σε βάρδια', 'Τελευταία ενημέρωση'];
    const csv = [
      header.join(','),
      ...rows.map(r => [
        `"${r.name.replace(/"/g, '""')}"`,
        r.driver_code ?? '',
        r.available.toFixed(2),
        r.pending.toFixed(2),
        (r.available + r.pending).toFixed(2),
        r.shift_cash.toFixed(2),
        r.on_shift ? 'Ναι' : 'Όχι',
        r.updated_at ? format(new Date(r.updated_at), 'dd/MM/yyyy HH:mm') : '-',
      ].join(',')),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `driver-payables-${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV κατέβηκε');
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  const buildInvoice = (rows: typeof filtered, titleSuffix?: string) => {
    if (rows.length === 0) { toast.error('Δεν υπάρχουν υπόλοιπα για τιμολόγηση'); return; }
    const today = format(new Date(), 'dd/MM/yyyy');
    const invoiceNo = `DRV-${format(new Date(), 'yyyyMMdd-HHmm')}`;
    const body = rows.map(r => {
      const gross = r.available + r.pending;
      const net = gross / (1 + VAT_RATE);
      const vat = gross - net;
      return `<tr>
        <td>${r.name.replace(/</g, '&lt;')}${r.driver_code ? ' <span style="color:#888">#'+r.driver_code+'</span>' : ''}</td>
        <td class="r">€${r.available.toFixed(2)}</td>
        <td class="r">€${r.pending.toFixed(2)}</td>
        <td class="r">€${net.toFixed(2)}</td>
        <td class="r">€${vat.toFixed(2)}</td>
        <td class="r"><strong>€${gross.toFixed(2)}</strong></td>
      </tr>`;
    }).join('');
    const totalGross = rows.reduce((s, r) => s + r.available + r.pending, 0);
    const totalNet = totalGross / (1 + VAT_RATE);
    const totalVat = totalGross - totalNet;
    const html = `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>${invoiceNo}</title>
    <style>
      *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:32px;max-width:900px;margin:0 auto}
      h1{margin:0 0 4px;font-size:22px} .meta{color:#666;font-size:13px;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;font-size:13px} th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
      th{background:#f6f8fa;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#555}
      .r{text-align:right} tfoot td{border-top:2px solid #111;font-weight:700;background:#fafafa}
      .actions{margin-top:24px;text-align:right} button{padding:8px 16px;border:1px solid #111;background:#111;color:#fff;border-radius:6px;cursor:pointer;font-size:13px}
      @media print {.actions{display:none}}
    </style></head><body>
      <h1>Τιμολόγιο Οδηγών${titleSuffix ? ' · ' + titleSuffix : ''}</h1>
      <div class="meta">№ ${invoiceNo} · Ημερομηνία: ${today} · ΦΠΑ ${(VAT_RATE*100).toFixed(0)}%</div>
      <table>
        <thead><tr><th>Οδηγός</th><th class="r">Διαθέσιμο</th><th class="r">Εκκρεμές</th><th class="r">Καθαρό</th><th class="r">ΦΠΑ ${(VAT_RATE*100).toFixed(0)}%</th><th class="r">Σύνολο</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="3">ΣΥΝΟΛΑ</td><td class="r">€${totalNet.toFixed(2)}</td><td class="r">€${totalVat.toFixed(2)}</td><td class="r">€${totalGross.toFixed(2)}</td></tr></tfoot>
      </table>
      <div class="actions"><button onclick="window.print()">Εκτύπωση / Αποθήκευση PDF</button></div>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${invoiceNo}.html`); toast.success('Τιμολόγιο κατέβηκε'); return; }
    w.document.write(html); w.document.close();
    toast.success('Τιμολόγιο δημιουργήθηκε');
  };

  const exportInvoice = () => buildInvoice(filtered.filter(r => r.available + r.pending !== 0));
  const exportRowInvoice = (row: typeof filtered[number]) => buildInvoice([row], row.name);

  const doLifetimeReset = async () => {
    if (!lifetimeTarget) return;
    setBusy(`L-${lifetimeTarget.id}`);
    try {
      const { error } = await (supabase.rpc as any)('admin_reset_driver_lifetime', { p_driver_id: lifetimeTarget.id });
      if (error) throw error;
      toast.success(`Lifetime μηδενίστηκε: ${lifetimeTarget.name}`);
      setLifetimeTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-driver-payables'] });
    } catch (e: any) { toast.error(e?.message ?? 'Αποτυχία'); }
    finally { setBusy(null); }
  };

  const doBulkLifetimeReset = async () => {
    setBusy('bulkL');
    try {
      const { data, error } = await (supabase.rpc as any)('admin_reset_all_driver_lifetime');
      if (error) throw error;
      toast.success(`Μηδενίστηκε lifetime σε ${data ?? 0} οδηγούς`);
      setBulkLifetimeOpen(false);
      qc.invalidateQueries({ queryKey: ['admin-driver-payables'] });
    } catch (e: any) { toast.error(e?.message ?? 'Αποτυχία'); }
    finally { setBusy(null); }
  };

  const doWalletReset = async () => {
    if (!walletTarget) return;
    setBusy(`w-${walletTarget.id}`);
    try {
      const { error } = await (supabase.rpc as any)('admin_reset_driver_wallet', { p_driver_id: walletTarget.id });
      if (error) throw error;
      toast.success(`Πορτοφόλι μηδενίστηκε: ${walletTarget.name}`);
      setWalletTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-driver-payables'] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία');
    } finally { setBusy(null); }
  };

  const doCashReset = async () => {
    if (!cashTarget) return;
    setBusy(`c-${cashTarget.id}`);
    try {
      const { error } = await (supabase.rpc as any)('admin_reset_driver_cash', { p_driver_id: cashTarget.id });
      if (error) throw error;
      toast.success(`Ταμείο βάρδιας μηδενίστηκε: ${cashTarget.name}`);
      setCashTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-driver-payables'] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία');
    } finally { setBusy(null); }
  };

  const doBulkReset = async () => {
    setBusy('bulk');
    try {
      const { error } = await (supabase.rpc as any)('admin_reset_all_driver_wallets');
      if (error) throw error;
      toast.success('Όλα τα πορτοφόλια οδηγών μηδενίστηκαν');
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ['admin-driver-payables'] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="admin-section-header">
        <div>
          <h2 className="admin-section-title">Πληρωμές προς Οδηγούς</h2>
          <p className="admin-section-sub mt-0.5">
            Πόσα χρωστάει ο admin σε κάθε οδηγό + μετρητά βάρδιας — με δυνατότητα μηδενισμού μετά την πληρωμή/συμψηφισμό.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button size="sm" variant="outline" className="h-8" onClick={exportCsv}>
            <FileDown className="h-3.5 w-3.5 mr-1.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={exportInvoice}>
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Τιμολόγιο ΦΠΑ
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-warning/60 text-warning hover:bg-warning/10 hover:text-warning"
            onClick={() => setBulkLifetimeOpen(true)}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset lifetime
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setBulkOpen(true)}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Μηδενισμός όλων
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-emerald-500/10 flex items-center justify-center">
              <Wallet className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin χρωστάει συνολικά</p>
              <p className="font-heading font-bold text-xl tabular-nums text-emerald-600">€{totals.owe.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-warning">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-warning/10 flex items-center justify-center">
              <HandCoins className="h-4 w-4 text-warning" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Μετρητά βάρδιας (σύνολο)</p>
              <p className="font-heading font-bold text-xl tabular-nums text-warning">€{totals.cash.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
              <Banknote className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Σε βάρδια τώρα</p>
              <p className="font-heading font-bold text-xl tabular-nums">{totals.onShift}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center">
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Σύνολο οδηγών</p>
              <p className="font-heading font-bold text-xl tabular-nums">{totals.drivers}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Αναζήτηση οδηγού…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-8 h-9 bg-muted/40 border-border/60"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Οδηγός</TableHead>
                <TableHead className="text-right">Διαθέσιμο</TableHead>
                <TableHead className="text-right hidden md:table-cell">Εκκρεμές</TableHead>
                <TableHead className="text-right">Σύνολο</TableHead>
                <TableHead className="text-right">Μετρητά βάρδιας</TableHead>
                <TableHead className="text-right">Ενέργειες</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Φόρτωση…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    Δεν βρέθηκαν οδηγοί.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const total = r.available + r.pending;
                  const owe = total > 0;
                  const zero = total === 0;
                  const cashZero = r.shift_cash === 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{r.name}</span>
                          {r.driver_code && (
                            <span className="text-[10px] font-mono text-muted-foreground">#{r.driver_code}</span>
                          )}
                          {r.on_shift && (
                            <Badge className="text-[10px] h-4 px-1 bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20">Live</Badge>
                          )}
                          {r.is_active === false && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1">Ανενεργός</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">€{r.available.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground hidden md:table-cell">€{r.pending.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-heading font-bold tabular-nums ${owe ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        €{total.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${r.shift_cash > 0 ? 'text-warning font-semibold' : 'text-muted-foreground'}`}>
                        €{r.shift_cash.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={zero}
                            onClick={() => exportRowInvoice(r)}
                            title="Τιμολόγιο για αυτόν τον οδηγό"
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            Τιμολόγιο
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={r.withdrawn === 0 || busy === `L-${r.id}`}
                            className="h-8 border-warning/50 text-warning hover:bg-warning/10 hover:text-warning"
                            onClick={() => setLifetimeTarget({ id: r.id, name: r.name, amount: r.withdrawn })}
                            title="Μηδένισε lifetime totals"
                          >
                            {busy === `L-${r.id}` ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                            Lifetime 0
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={zero || busy === `w-${r.id}`}
                            className="h-8"
                            onClick={() => setWalletTarget({ id: r.id, name: r.name, amount: total })}
                            title="Reset πορτοφολιού"
                          >
                            {busy === `w-${r.id}` ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wallet className="h-3 w-3 mr-1" />}
                            Wallet 0
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cashZero || busy === `c-${r.id}`}
                            className="h-8"
                            onClick={() => setCashTarget({ id: r.id, name: r.name, amount: r.shift_cash })}
                            title="Reset μετρητών βάρδιας"
                          >
                            {busy === `c-${r.id}` ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <HandCoins className="h-3 w-3 mr-1" />}
                            Cash 0
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Wallet reset confirm */}
      <AlertDialog open={!!walletTarget} onOpenChange={(v) => !v && setWalletTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Μηδενισμός πορτοφολιού
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Θα μηδενιστεί το πορτοφόλι του <strong>{walletTarget?.name}</strong>{' '}
                  (<span className="text-emerald-600">€{walletTarget?.amount.toFixed(2)}</span>) — διαθέσιμο + εκκρεμές.
                </p>
                <p className="text-muted-foreground">Χρήση μετά από payout. Lifetime totals διατηρούνται.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Άκυρο</AlertDialogCancel>
            <AlertDialogAction onClick={doWalletReset} disabled={!!busy}>
              {busy?.startsWith('w-') && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Μηδενισμός
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cash reset confirm */}
      <AlertDialog open={!!cashTarget} onOpenChange={(v) => !v && setCashTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Μηδενισμός μετρητών βάρδιας
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Θα μηδενιστούν τα μετρητά βάρδιας του <strong>{cashTarget?.name}</strong>{' '}
                  (<span className="text-warning">€{cashTarget?.amount.toFixed(2)}</span>).
                </p>
                <p className="text-muted-foreground">Χρήση μόνο μετά από φυσική παράδοση μετρητών.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Άκυρο</AlertDialogCancel>
            <AlertDialogAction onClick={doCashReset} disabled={!!busy}>
              {busy?.startsWith('c-') && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Μηδενισμός
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk reset confirm */}
      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Μηδενισμός ΟΛΩΝ των πορτοφολιών οδηγών
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Θα μηδενιστεί <strong>διαθέσιμο + εκκρεμές</strong> κάθε οδηγού.</p>
                <p className="text-warning">Χρήση μόνο μετά από batch payout. Lifetime totals διατηρούνται.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Άκυρο</AlertDialogCancel>
            <AlertDialogAction onClick={doBulkReset} disabled={!!busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {busy === 'bulk' && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Μηδενισμός όλων
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Per-driver lifetime reset */}
      <AlertDialog open={!!lifetimeTarget} onOpenChange={(v) => !v && setLifetimeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Μηδενισμός lifetime
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Θα μηδενιστεί το lifetime του <strong>{lifetimeTarget?.name}</strong> (€{lifetimeTarget?.amount.toFixed(2)}).</p>
                <p className="text-muted-foreground">Ενεργό υπόλοιπο & ιστορικό δεν αλλάζουν.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Άκυρο</AlertDialogCancel>
            <AlertDialogAction onClick={doLifetimeReset} disabled={!!busy}>
              {busy?.startsWith('L-') && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Μηδενισμός
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk lifetime reset */}
      <AlertDialog open={bulkLifetimeOpen} onOpenChange={setBulkLifetimeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Μηδενισμός lifetime (όλοι)
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Θα μηδενιστούν τα <strong>lifetime totals</strong> όλων των οδηγών.</p>
                <p className="text-muted-foreground">Ενεργά πορτοφόλια & μετρητά βάρδιας δεν αλλάζουν.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Άκυρο</AlertDialogCancel>
            <AlertDialogAction onClick={doBulkLifetimeReset} disabled={!!busy}>
              {busy === 'bulkL' && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Μηδενισμός
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
