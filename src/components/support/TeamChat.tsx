import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Hash, Loader2, Plus, Users, Circle, MessageCircle, Megaphone, Flame } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { toast } from 'sonner';
import { ChatComposer, type ComposerAttachment } from '@/components/chat/ChatComposer';
import { ChatAttachment } from '@/components/chat/ChatAttachment';

interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: string;
  created_at: string;
}

interface TeamMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_role: string;
  message: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  created_at: string;
}

interface AgentProfile {
  user_id: string;
  full_name: string | null;
}

const channelIcon = (name: string) => {
  if (name === 'announcements') return Megaphone;
  if (name === 'escalations') return Flame;
  return Hash;
};

function formatStamp(d: Date) {
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return `Χθες ${format(d, 'HH:mm')}`;
  return format(d, 'dd MMM HH:mm');
}

export function TeamChat() {
  const { user, profile, isAdmin } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load channels
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('support_channels')
        .select('*')
        .order('created_at', { ascending: true });
      const list = (data ?? []) as Channel[];
      setChannels(list);
      if (!activeChannel && list.length) setActiveChannel(list[0]);
    };
    load();

    const ch = supabase
      .channel('team-channels')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_channels' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load support/admin agent profiles for name + roster
  useEffect(() => {
    const load = async () => {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['support', 'admin']);
      const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
      if (!ids.length) {
        setAgents([]);
        return;
      }
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', ids);
      setAgents((profs ?? []) as AgentProfile[]);
    };
    load();
  }, []);

  // Load messages + subscribe
  useEffect(() => {
    if (!activeChannel) return;
    let active = true;
    setLoadingMsgs(true);

    const load = async () => {
      const { data } = await supabase
        .from('support_team_messages')
        .select('*')
        .eq('channel_id', activeChannel.id)
        .order('created_at', { ascending: true })
        .limit(200);
      if (active) {
        setMessages((data ?? []) as TeamMessage[]);
        setLoadingMsgs(false);
      }
    };
    load();

    const ch = supabase
      .channel(`team-msgs-${activeChannel.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_team_messages',
          filter: `channel_id=eq.${activeChannel.id}`,
        },
        (payload) => {
          const incoming = payload.new as TeamMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            const optIdx = prev.findIndex(
              (m) =>
                m.sender_id === incoming.sender_id &&
                m.message === incoming.message &&
                Math.abs(new Date(m.created_at).getTime() - new Date(incoming.created_at).getTime()) < 10000
            );
            if (optIdx >= 0) {
              const next = [...prev];
              next[optIdx] = incoming;
              return next;
            }
            return [...prev, incoming];
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [activeChannel]);

  // Presence: track which agents are online
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('support-presence', {
      config: { presence: { key: user.id } },
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      const online: Record<string, boolean> = {};
      Object.keys(state).forEach((uid) => {
        online[uid] = true;
      });
      setPresence(online);
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ name: profile?.full_name ?? 'Agent', joined_at: new Date().toISOString() });
      }
    });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, profile?.full_name]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, activeChannel?.id]);

  const agentName = (id: string) =>
    agents.find((a) => a.user_id === id)?.full_name ?? id.slice(0, 6);

  const onlineAgents = useMemo(
    () => agents.filter((a) => presence[a.user_id]),
    [agents, presence]
  );
  const offlineAgents = useMemo(
    () => agents.filter((a) => !presence[a.user_id]),
    [agents, presence]
  );

  const send = async (msgText: string, attachment: ComposerAttachment | null) => {
    if ((!msgText.trim() && !attachment) || !user || !activeChannel) return;
    const senderRole = isAdmin ? 'admin' : profile?.role ?? 'support';
    const optimistic: TeamMessage = {
      id: crypto.randomUUID(),
      channel_id: activeChannel.id,
      sender_id: user.id,
      sender_role: senderRole,
      message: msgText.trim() || null,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    const { error } = await supabase.from('support_team_messages').insert({
      channel_id: activeChannel.id,
      sender_id: user.id,
      sender_role: senderRole,
      message: msgText.trim() || null,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
    } as any);
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error('Αποτυχία αποστολής');
    }
  };

  const createChannel = async () => {
    if (!newName.trim() || !user) return;
    const safe = newName.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 32);
    const { data, error } = await supabase
      .from('support_channels')
      .insert({ name: safe, description: newDesc.trim() || null, type: 'channel', created_by: user.id })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Κανάλι δημιουργήθηκε');
    setCreateOpen(false);
    setNewName('');
    setNewDesc('');
    if (data) setActiveChannel(data as Channel);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_200px] gap-3 h-[calc(100vh-9rem)] min-h-[520px]">
      {/* Channels sidebar */}
      <div className="rounded-xl border bg-card flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide font-bold text-muted-foreground">Κανάλια</p>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {channels.map((c) => {
            const Icon = channelIcon(c.name);
            const active = activeChannel?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveChannel(c)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                  active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/60 text-foreground/80'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Messages pane */}
      <div className="rounded-xl border bg-card flex flex-col overflow-hidden min-w-0">
        <div className="px-4 py-2.5 border-b flex items-center gap-2">
          {activeChannel && (() => {
            const Icon = channelIcon(activeChannel.name);
            return <Icon className="h-4 w-4 text-muted-foreground" />;
          })()}
          <div className="flex-1 min-w-0">
            <p className="font-heading font-semibold text-sm truncate">
              {activeChannel?.name ?? '—'}
            </p>
            {activeChannel?.description && (
              <p className="text-[11px] text-muted-foreground truncate">{activeChannel.description}</p>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" /> {onlineAgents.length} online
          </span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {loadingMsgs ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Καμία συζήτηση ακόμα. Ξεκίνησε την κουβέντα!</p>
            </div>
          ) : (
            messages.map((m, i) => {
              const prev = messages[i - 1];
              const sameSender =
                prev &&
                prev.sender_id === m.sender_id &&
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
              const isMine = m.sender_id === user?.id;
              const isAdminMsg = m.sender_role === 'admin';
              return (
                <div key={m.id} className={`flex flex-col ${sameSender ? 'mt-0.5' : 'mt-2'}`}>
                  {!sameSender && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className={`text-xs font-semibold ${isMine ? 'text-primary' : isAdminMsg ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>
                        {agentName(m.sender_id)}
                        {isAdminMsg && <span className="ml-1 text-[9px] uppercase opacity-70">admin</span>}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatStamp(new Date(m.created_at))}
                      </span>
                    </div>
                  )}
                  {m.attachment_url && (
                    <div className={m.message ? 'mb-1' : ''}>
                      <ChatAttachment url={m.attachment_url} type={m.attachment_type} />
                    </div>
                  )}
                  {m.message && (
                    <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        <ChatComposer
          onSend={send}
          draft={draft}
          onDraftChange={setDraft}
          uploadFolder="team"
          disabled={!activeChannel}
          placeholder={activeChannel ? `Μήνυμα στο #${activeChannel.name}` : 'Επίλεξε κανάλι'}
          rows={1}
        />
      </div>

      {/* Roster */}
      <div className="rounded-xl border bg-card flex flex-col overflow-hidden hidden md:flex">
        <div className="px-3 py-2 border-b">
          <p className="text-[11px] uppercase tracking-wide font-bold text-muted-foreground">Ομάδα</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-600 px-1 mb-1">
              Online — {onlineAgents.length}
            </p>
            <div className="space-y-0.5">
              {onlineAgents.map((a) => (
                <div key={a.user_id} className="flex items-center gap-2 px-1.5 py-1 rounded text-xs">
                  <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
                  <span className="truncate">{a.full_name ?? a.user_id.slice(0, 6)}</span>
                </div>
              ))}
              {!onlineAgents.length && (
                <p className="text-[10px] text-muted-foreground px-1.5">Κανείς online</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground px-1 mb-1">
              Offline — {offlineAgents.length}
            </p>
            <div className="space-y-0.5">
              {offlineAgents.map((a) => (
                <div key={a.user_id} className="flex items-center gap-2 px-1.5 py-1 rounded text-xs text-muted-foreground">
                  <Circle className="h-2 w-2 fill-muted text-muted" />
                  <span className="truncate">{a.full_name ?? a.user_id.slice(0, 6)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Νέο κανάλι</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Όνομα</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="π.χ. shift-night"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Πεζά γράμματα, αριθμοί, παύλες.</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Περιγραφή (προαιρετικά)</label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Σύντομη περιγραφή"
              />
            </div>
            <Button onClick={createChannel} disabled={!newName.trim()} className="w-full">
              Δημιουργία
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
