import { useEffect, useState } from 'react';
import { Banknote, Lock, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useDriverState } from '@/hooks/useDriverState';
import { supabase } from '@/integrations/supabase/client';

export default function CashTracker() {
  const { state } = useDriverState();
  const [cap, setCap] = useState<number>(200);

  useEffect(() => {
    (supabase as any)
      .rpc('get_platform_settings_public')
      .then(({ data }: any) => {
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.max_cash_cap != null) setCap(Number(row.max_cash_cap));
      });
  }, []);

  const [ackResetAt, setAckResetAt] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('driver_cash_reset_ack') : null
  );

  if (!state) return null;

  const cash = Number(state.shift_cash_balance);
  const pct = Math.min((cash / Math.max(cap, 1)) * 100, 100);
  const isCapped = cash >= cap;
  const isWarning = !isCapped && pct >= 80;
  const lastReset = state.last_cash_reset_at;
  const showResetNotice = !!lastReset && lastReset !== ackResetAt;

  const dismissReset = () => {
    if (!lastReset) return;
    localStorage.setItem('driver_cash_reset_ack', lastReset);
    setAckResetAt(lastReset);
  };

  return (
    <Card className={`shadow-[var(--shadow-md)] ${isCapped ? 'border-2 border-destructive' : isWarning ? 'border-2 border-orange-500' : ''}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className={`h-5 w-5 ${isCapped ? 'text-destructive' : isWarning ? 'text-orange-500' : 'text-success'}`} />
            <h3 className="font-heading font-bold text-foreground">Ταμείο Βάρδιας</h3>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground bg-muted px-2 py-1 rounded-md">
            <Lock className="h-3 w-3" />
            Read-only
          </span>
        </div>
        <p className={`text-3xl font-heading font-extrabold tabular-nums ${isCapped ? 'text-destructive' : 'text-foreground'}`}>
          €{cash.toFixed(2)}
          <span className="text-sm font-normal text-muted-foreground ml-2">/ €{cap.toFixed(0)}</span>
        </p>
        <Progress value={pct} className={isCapped ? '[&>div]:bg-destructive' : isWarning ? '[&>div]:bg-orange-500' : ''} />

        {showResetNotice && (
          <div className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/30 p-3">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed flex-1">
              <p className="font-bold text-success mb-0.5">Ο διαχειριστής μηδένισε το ταμείο</p>
              <p className="text-foreground/80">
                Παρέδωσες τα μετρητά στις {new Date(lastReset!).toLocaleString('el-GR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}. Καλή συνέχεια στη βάρδια!
              </p>
            </div>
            <button onClick={dismissReset} className="text-muted-foreground hover:text-foreground p-0.5" aria-label="Κλείσιμο">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}


        {isCapped ? (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <p className="font-bold text-destructive mb-0.5">Παύση νέων παραγγελιών</p>
              <p className="text-foreground/80">
                Έχεις φτάσει το όριο μετρητών (€{cap}). Παρέδωσε τα χρήματα σε διαχειριστή για να ξεκλειδωθούν νέες παραγγελίες.
              </p>
            </div>
          </div>
        ) : isWarning ? (
          <p className="text-xs text-orange-600 dark:text-orange-400 leading-relaxed">
            ⚠️ Πλησιάζεις το όριο μετρητών (€{cap}). Σκέψου να παραδώσεις τα χρήματα στον διαχειριστή σύντομα.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Σύνολο μετρητών που έχεις εισπράξει σε αυτή τη βάρδια.
            Όριο: €{cap}. Μόνο ο διαχειριστής μπορεί να μηδενίσει το ποσό.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
