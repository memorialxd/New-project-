import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Send, Trash2, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNowStrict, isPast } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';

const audienceLabels: Record<string, string> = {
  all: 'Όλοι',
  drivers: 'Οδηγοί',
  store_owners: 'Καταστήματα',
  support: 'Υποστήριξη',
};

const audienceColors: Record<string, string> = {
  all: 'bg-primary/10 text-primary border-primary/20',
  drivers: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  store_owners: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  support: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
};

// Duration presets in minutes; null = forever
const DURATION_PRESETS: { label: string; minutes: number | null }[] = [
  { label: '15 λεπτά', minutes: 15 },
  { label: '1 ώρα', minutes: 60 },
  { label: '4 ώρες', minutes: 240 },
  { label: '24 ώρες', minutes: 60 * 24 },
  { label: '3 ημέρες', minutes: 60 * 24 * 3 },
  { label: '7 ημέρες', minutes: 60 * 24 * 7 },
  { label: 'Μόνιμο (χωρίς λήξη)', minutes: null },
];

export default function AnnouncementsManager() {
  const { user } = useAuth();
  const { data: announcements, isLoading } = useAnnouncements();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<string>('all');
  // Default: support → forever, others → 1 hour
  const [durationKey, setDurationKey] = useState<string>('60');
  const [sending, setSending] = useState(false);

  // When switching to "support", default to forever; switching away → 1h
  const handleAudienceChange = (val: string) => {
    setAudience(val);
    if (val === 'support') setDurationKey('forever');
    else if (durationKey === 'forever') setDurationKey('60');
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim() || !user) return;
    setSending(true);
    const minutes = durationKey === 'forever' ? null : parseInt(durationKey, 10);
    const expires_at = minutes != null ? new Date(Date.now() + minutes * 60_000).toISOString() : null;

    const { error } = await supabase.from('announcements').insert({
      title: title.trim(),
      message: message.trim(),
      target_audience: audience,
      created_by: user.id,
      expires_at,
    } as any);
    setSending(false);
    if (error) {
      toast.error('Αποτυχία αποστολής ανακοίνωσης');
    } else {
      toast.success('Η ανακοίνωση στάλθηκε!');
      setTitle('');
      setMessage('');
      setAudience('all');
      setDurationKey('60');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) toast.error('Αποτυχία διαγραφής');
    else {
      toast.success('Η ανακοίνωση διαγράφηκε');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    }
  };

  const sorted = useMemo(() => {
    return (announcements ?? []).slice().sort((a: any, b: any) => {
      const ae = a.expires_at ? isPast(new Date(a.expires_at)) : false;
      const be = b.expires_at ? isPast(new Date(b.expires_at)) : false;
      if (ae !== be) return ae ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [announcements]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> Νέα Ανακοίνωση
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Τίτλος ανακοίνωσης"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="Γράψτε το μήνυμά σας..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-stretch">
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Παραλήπτες
              </label>
              <Select value={audience} onValueChange={handleAudienceChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Όλοι (Οδηγοί + Καταστήματα + Υποστήριξη)</SelectItem>
                  <SelectItem value="drivers">Μόνο Οδηγοί</SelectItem>
                  <SelectItem value="store_owners">Μόνο Καταστήματα</SelectItem>
                  <SelectItem value="support">Μόνο Υποστήριξη (μπορεί να μείνει για πάντα)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Διάρκεια εμφάνισης
              </label>
              <Select value={durationKey} onValueChange={setDurationKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.minutes == null ? 'forever' : String(p.minutes)}>
                      {p.minutes == null ? '∞ ' : ''}
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleSend}
                disabled={sending || !title.trim() || !message.trim()}
                className="w-full md:w-auto"
              >
                <Send className="h-4 w-4 mr-2" />
                {sending ? 'Αποστολή...' : 'Αποστολή'}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            💡 Οι ανακοινώσεις προς <b>Όλους</b>, <b>Οδηγούς</b> ή <b>Καταστήματα</b> εμφανίζονται με χρονόμετρο και
            εξαφανίζονται αυτόματα. Οι ανακοινώσεις προς την <b>Υποστήριξη</b> μπορούν να μείνουν για πάντα.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Απεσταλμένες Ανακοινώσεις</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Φόρτωση...</p>}
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Δεν υπάρχουν ανακοινώσεις</p>
          )}
          {sorted.map((a: any) => {
            const expiresAt = a.expires_at ? new Date(a.expires_at) : null;
            const expired = expiresAt ? isPast(expiresAt) : false;
            return (
              <div
                key={a.id}
                className={`border rounded-lg p-3 space-y-1 ${expired ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="font-semibold text-sm">{a.title}</h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={audienceColors[a.target_audience] ?? ''}>
                      {audienceLabels[a.target_audience] ?? a.target_audience}
                    </Badge>
                    {expiresAt ? (
                      <Badge
                        variant="outline"
                        className={
                          expired
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-amber-500/10 text-amber-700 border-amber-500/20'
                        }
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        {expired
                          ? 'Έληξε'
                          : `Λήγει σε ${formatDistanceToNowStrict(expiresAt)}`}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                        <InfinityIcon className="h-3 w-3 mr-1" /> Μόνιμο
                      </Badge>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(a.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{a.message}</p>
                <p className="text-xs text-muted-foreground/60">
                  {format(new Date(a.created_at), 'dd MMM yyyy · HH:mm')}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
