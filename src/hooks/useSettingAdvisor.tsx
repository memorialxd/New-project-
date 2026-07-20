import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, ShieldAlert, ShieldCheck, AlertTriangle, ArrowRight, Users, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

export interface AdvisorRequest {
  setting_area: string;
  setting_label: string;
  setting_key?: string;
  current_value: unknown;
  proposed_value: unknown;
  context?: Record<string, unknown>;
}

export interface AdvisorResponse {
  recommendation: 'proceed' | 'caution' | 'block';
  summary: string;
  affected: string[];
  impacts: string[];
  risks: string[];
  reason: string;
}

interface State {
  open: boolean;
  loading: boolean;
  request: AdvisorRequest | null;
  response: AdvisorResponse | null;
  onConfirm: (() => Promise<void> | void) | null;
  applying: boolean;
}

const initial: State = {
  open: false, loading: false, request: null, response: null, onConfirm: null, applying: false,
};

/**
 * Hook that wraps any "save admin setting" action with an AI suggestion preview.
 * Usage:
 *   const { advise, AdvisorDialog } = useSettingAdvisor();
 *   advise(request, async () => { ...actually save... });
 *   {AdvisorDialog}
 */
export function useSettingAdvisor() {
  const [state, setState] = useState<State>(initial);

  const advise = useCallback(async (req: AdvisorRequest, onConfirm: () => Promise<void> | void) => {
    setState({ ...initial, open: true, loading: true, request: req, onConfirm });
    try {
      const { data, error } = await supabase.functions.invoke('admin-setting-advisor', { body: req });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setState(s => ({ ...s, loading: false, response: data as AdvisorResponse }));
    } catch (e: any) {
      setState(initial);
      toast.error(e?.message ?? 'Αποτυχία ανάλυσης AI');
    }
  }, []);

  const close = () => setState(initial);

  const confirm = async () => {
    if (!state.onConfirm) return;
    setState(s => ({ ...s, applying: true }));
    try {
      await state.onConfirm();
      setState(initial);
    } catch (e: any) {
      setState(s => ({ ...s, applying: false }));
      toast.error(e?.message ?? 'Αποτυχία εφαρμογής');
    }
  };

  const r = state.response;
  const recColor = r?.recommendation === 'proceed'
    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
    : r?.recommendation === 'caution'
    ? 'bg-orange-500/10 text-orange-700 border-orange-500/30'
    : 'bg-destructive/10 text-destructive border-destructive/30';

  const RecIcon = r?.recommendation === 'proceed' ? ShieldCheck
    : r?.recommendation === 'block' ? ShieldAlert : AlertTriangle;

  const recLabel = r?.recommendation === 'proceed' ? 'Προχώρα'
    : r?.recommendation === 'caution' ? 'Προσοχή' : 'Μπλοκ';

  const AdvisorDialog = (
    <AlertDialog open={state.open} onOpenChange={(v) => { if (!v && !state.applying) close(); }}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Πρόταση AI πριν την αλλαγή
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {state.request && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <p className="font-semibold text-foreground">{state.request.setting_label}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <code className="px-1.5 py-0.5 rounded bg-background border">{String(state.request.current_value)}</code>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <code className="px-1.5 py-0.5 rounded bg-background border font-bold">{String(state.request.proposed_value)}</code>
                  </div>
                </div>
              )}

              {state.loading && (
                <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Αναλύω την αλλαγή…</span>
                </div>
              )}

              {r && (
                <>
                  <div className={`rounded-lg border p-3 ${recColor}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <RecIcon className="h-4 w-4" />
                      <Badge variant="outline" className={recColor}>{recLabel}</Badge>
                    </div>
                    <p className="text-sm">{r.summary}</p>
                  </div>

                  {r.affected.length > 0 && (
                    <div>
                      <p className="text-[11px] uppercase font-bold text-muted-foreground flex items-center gap-1 mb-1">
                        <Users className="h-3 w-3" /> Επηρεάζει
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {r.affected.map((a, i) => <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>)}
                      </div>
                    </div>
                  )}

                  {r.impacts.length > 0 && (
                    <div>
                      <p className="text-[11px] uppercase font-bold text-muted-foreground mb-1">Αντίκτυπος</p>
                      <ul className="space-y-1 text-[13px] text-foreground/80 list-disc pl-4">
                        {r.impacts.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}

                  {r.risks.length > 0 && (
                    <div>
                      <p className="text-[11px] uppercase font-bold text-orange-600 flex items-center gap-1 mb-1">
                        <TrendingDown className="h-3 w-3" /> Κίνδυνοι
                      </p>
                      <ul className="space-y-1 text-[13px] text-foreground/80 list-disc pl-4">
                        {r.risks.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}

                  <p className="text-[11px] text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                    {r.reason}
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={state.applying}>Άκυρο</AlertDialogCancel>
          <AlertDialogAction
            disabled={state.loading || state.applying || r?.recommendation === 'block'}
            onClick={(e) => { e.preventDefault(); confirm(); }}
            className={r?.recommendation === 'block' ? 'opacity-50' : ''}
          >
            {state.applying ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            {r?.recommendation === 'block' ? 'Μπλοκαρισμένο' : 'Εφαρμογή τώρα'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { advise, AdvisorDialog };
}
