import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { AlertTriangle, FileDown, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import PricingModelExplainer from './PricingModelExplainer';

/**
 * Two destructive admin actions:
 *  1. Reset money to zero  — wallets/treasury → 0, history kept, CSV export
 *  2. Wipe transactions    — deletes all order/ledger/notification history
 *
 * Both download a CSV snapshot of the pre-action state before executing.
 */

function downloadSnapshotCsv(filename: string, snapshot: Record<string, any>) {
  const rows = [
    ['Field', 'Value'],
    ...Object.entries(snapshot).map(([k, v]) => [k, String(v ?? '')]),
  ];
  const csv = rows
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ConfirmTypeDialog({
  open, onOpenChange, title, body, expected, confirmLabel, busy, onConfirm, tone = 'destructive',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: React.ReactNode;
  expected: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  tone?: 'warning' | 'destructive';
}) {
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toUpperCase() === expected;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setTyped(''); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className={tone === 'destructive' ? 'h-5 w-5 text-destructive' : 'h-5 w-5 text-warning'} />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">{body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">
            Πληκτρολόγησε <span className="font-mono font-bold">{expected}</span> για επιβεβαίωση
          </Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            className="font-mono"
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Άκυρο</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ok || busy}
            onClick={onConfirm}
            className={tone === 'destructive' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function SystemResetPanel() {
  const [resetOpen, setResetOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [busy, setBusy] = useState<'reset' | 'wipe' | null>(null);

  const handleReset = async () => {
    setBusy('reset');
    try {
      const { data, error } = await (supabase.rpc as any)('admin_reset_money_to_zero');
      if (error) throw error;
      const stamp = format(new Date(), 'yyyy-MM-dd_HHmm');
      downloadSnapshotCsv(`money-reset-snapshot-${stamp}.csv`, data ?? {});
      toast.success('Όλα τα ταμεία μηδενίστηκαν · CSV κατεβαίνει');
      setResetOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία reset');
    } finally {
      setBusy(null);
    }
  };

  const handleWipe = async () => {
    setBusy('wipe');
    try {
      const { data, error } = await (supabase.rpc as any)('admin_wipe_transactions');
      if (error) throw error;
      const stamp = format(new Date(), 'yyyy-MM-dd_HHmm');
      downloadSnapshotCsv(`transactions-wipe-snapshot-${stamp}.csv`, data ?? {});
      toast.success('Η εφαρμογή είναι σαν καινούργια · CSV κατεβαίνει');
      setWipeOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία wipe');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="admin-section-header">
        <div>
          <h2 className="admin-section-title">Επαναφορά Συστήματος</h2>
          <p className="admin-section-sub mt-0.5">
            Καταστροφικές ενέργειες — κάθε μία κατεβάζει CSV πριν εκτελεστεί.
          </p>
        </div>
      </div>

      <PricingModelExplainer />


      {/* Reset money to zero */}
      <div className="admin-card border-warning/40">
        <div className="p-3.5 flex items-start gap-3">
          <div className="h-9 w-9 rounded-md bg-warning/10 flex items-center justify-center shrink-0">
            <RotateCcw className="h-4 w-4 text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold">Μηδενισμός Ταμείων</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
              Επαναφέρει σε <strong>0</strong>: ταμείο admin, platform pool, πορτοφόλια καταστημάτων,
              πορτοφόλια οδηγών, μετρητά βάρδιας, εκκρεμή χρέη. Lifetime totals & ιστορικό παραγγελιών
              <strong> διατηρούνται</strong>. Snapshot σε CSV πριν την εκτέλεση.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5 h-8 border-warning/60 text-warning hover:bg-warning/10 hover:text-warning"
              onClick={() => setResetOpen(true)}
            >
              <FileDown className="h-3.5 w-3.5 mr-1.5" />
              Reset & κατέβασμα CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Wipe transactions */}
      <div className="admin-card border-destructive/40">
        <div className="p-3.5 flex items-start gap-3">
          <div className="h-9 w-9 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
            <Trash2 className="h-4 w-4 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold">Καθαρισμός Εφαρμογής (Σαν Καινούργια)</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
              <strong>Διαγράφει</strong>: όλες τις παραγγελίες, items, earnings, ledgers (admin/store/customer),
              monthly reports, χρέη, offer events, fraud signals, support tickets, notifications.
              <strong> Διατηρεί</strong>: χρήστες, καταστήματα, μενού, οδηγούς, ρυθμίσεις. Snapshot CSV πριν.
            </p>
            <Button
              size="sm"
              variant="destructive"
              className="mt-2.5 h-8"
              onClick={() => setWipeOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Wipe & κατέβασμα CSV
            </Button>
          </div>
        </div>
      </div>

      <ConfirmTypeDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        tone="warning"
        title="Επιβεβαίωση μηδενισμού ταμείων"
        body={
          <>
            <p>Θα μηδενιστούν όλα τα ενεργά υπόλοιπα. Δεν διαγράφεται καμία παραγγελία ή χρήστης.</p>
            <p className="text-warning">Θα κατέβει αμέσως ένα CSV snapshot με τα τρέχοντα υπόλοιπα.</p>
          </>
        }
        expected="RESET"
        confirmLabel="Μηδενισμός τώρα"
        busy={busy === 'reset'}
        onConfirm={handleReset}
      />

      <ConfirmTypeDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        tone="destructive"
        title="Επιβεβαίωση πλήρους καθαρισμού"
        body={
          <>
            <p>Όλο το ιστορικό συναλλαγών θα διαγραφεί <strong>μη αναστρέψιμα</strong>.</p>
            <p>Η εφαρμογή θα ξεκινήσει σαν καινούργια. Χρήστες, καταστήματα, μενού & ρυθμίσεις παραμένουν.</p>
            <p className="text-destructive">Θα κατέβει CSV snapshot με τα μετρήματα πριν τη διαγραφή.</p>
          </>
        }
        expected="WIPE"
        confirmLabel="Wipe τώρα"
        busy={busy === 'wipe'}
        onConfirm={handleWipe}
      />
    </div>
  );
}
