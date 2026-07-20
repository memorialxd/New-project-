import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, Copy, Check, MessageSquareText, Gauge, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  ticketId: string;
  onUseReply: (text: string) => void;
}

type Action = 'suggest_reply' | 'summarize' | 'triage' | 'custom';

interface Triage {
  priority?: string;
  suggested_status?: string;
  reason?: string;
  next_action?: string;
}

export function SupportAIPanel({ ticketId, onUseReply }: Props) {
  const [loading, setLoading] = useState<Action | null>(null);
  const [result, setResult] = useState('');
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async (action: Action) => {
    setLoading(action);
    setActiveAction(action);
    setResult('');
    try {
      const { data, error } = await supabase.functions.invoke('support-ai', {
        body: { ticketId, action, customPrompt: action === 'custom' ? customPrompt : undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult((data as any).result ?? '');
    } catch (e: any) {
      toast.error(e.message ?? 'Σφάλμα AI');
    } finally {
      setLoading(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  let triage: Triage | null = null;
  if (activeAction === 'triage' && result) {
    try {
      const cleaned = result.replace(/```json\n?|```/g, '').trim();
      triage = JSON.parse(cleaned);
    } catch {
      // not JSON
    }
  }

  const priorityColor = (p?: string) => {
    switch (p) {
      case 'critical': return 'bg-red-500/10 text-red-700 border-red-500/30';
      case 'high': return 'bg-orange-500/10 text-orange-700 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30';
      default: return 'bg-green-500/10 text-green-700 border-green-500/30';
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <p className="font-heading font-semibold text-sm">AI Βοηθός</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => run('suggest_reply')}
            disabled={loading !== null}
            className="h-auto py-2 flex-col gap-1"
          >
            {loading === 'suggest_reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
            <span className="text-[10px]">Πρόταση</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run('summarize')}
            disabled={loading !== null}
            className="h-auto py-2 flex-col gap-1"
          >
            {loading === 'summarize' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            <span className="text-[10px]">Σύνοψη</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run('triage')}
            disabled={loading !== null}
            className="h-auto py-2 flex-col gap-1"
          >
            {loading === 'triage' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
            <span className="text-[10px]">Triage</span>
          </Button>
        </div>

        <div className="flex gap-2">
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Ρώτησε κάτι για το ticket..."
            rows={1}
            className="resize-none text-sm min-h-[36px]"
          />
          <Button
            size="sm"
            onClick={() => run('custom')}
            disabled={loading !== null || !customPrompt.trim()}
          >
            {loading === 'custom' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ρώτα'}
          </Button>
        </div>

        {result && (
          <div className="bg-card border rounded-lg p-3 space-y-2">
            {triage ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase px-2 py-0.5 rounded border font-semibold ${priorityColor(triage.priority)}`}>
                    {triage.priority ?? '—'}
                  </span>
                  {triage.suggested_status && (
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded border bg-muted text-muted-foreground">
                      → {triage.suggested_status}
                    </span>
                  )}
                </div>
                {triage.reason && <p className="text-xs"><span className="font-semibold">Λόγος:</span> {triage.reason}</p>}
                {triage.next_action && <p className="text-xs"><span className="font-semibold">Επόμενο βήμα:</span> {triage.next_action}</p>}
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{result}</p>
            )}

            <div className="flex gap-2 pt-1 border-t">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copy}>
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? 'Αντιγράφηκε' : 'Αντιγραφή'}
              </Button>
              {activeAction === 'suggest_reply' && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onUseReply(result);
                    toast.success('Προστέθηκε στο πεδίο μηνύματος');
                  }}
                >
                  Χρήση ως απάντηση
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
