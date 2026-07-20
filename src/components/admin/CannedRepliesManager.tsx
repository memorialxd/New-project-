import { useEffect, useState } from 'react';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Reply {
  id: string;
  label: string;
  body: string;
  category: string | null;
  sort_order: number;
}

export default function CannedRepliesManager() {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');

  const load = async () => {
    const { data } = await (supabase as any).from('canned_replies').select('*').order('sort_order');
    setReplies(data ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!label.trim() || !body.trim()) return;
    const { error } = await (supabase as any).from('canned_replies').insert({
      label, body, category, sort_order: replies.length,
    });
    if (error) toast.error('Αποτυχία');
    else { toast.success('Προστέθηκε'); setLabel(''); setBody(''); load(); }
  };

  const remove = async (id: string) => {
    await (supabase as any).from('canned_replies').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h2 className="font-heading font-bold text-xl">Έτοιμες Απαντήσεις</h2>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-heading font-semibold text-sm">Νέα απάντηση</h3>
          <Input placeholder="Ετικέτα (π.χ. Καθυστέρηση)" value={label} onChange={e => setLabel(e.target.value)} />
          <Input placeholder="Κατηγορία (general, delivery, order)" value={category} onChange={e => setCategory(e.target.value)} />
          <Textarea placeholder="Κείμενο απάντησης..." value={body} onChange={e => setBody(e.target.value)} rows={3} />
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Προσθήκη</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {replies.map(r => (
          <Card key={r.id}>
            <CardContent className="p-3 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-heading font-semibold text-sm">{r.label}</span>
                  {r.category && <span className="text-[10px] uppercase text-muted-foreground">{r.category}</span>}
                </div>
                <p className="text-xs text-muted-foreground">{r.body}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </CardContent>
          </Card>
        ))}
        {replies.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">Δεν υπάρχουν έτοιμες απαντήσεις</p>
        )}
      </div>
    </div>
  );
}
