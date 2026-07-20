import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, CheckCircle2, Headphones } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ChatComposer, type ComposerAttachment } from '@/components/chat/ChatComposer';
import { ChatAttachment } from '@/components/chat/ChatAttachment';

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  created_at: string;
}

interface AgentInfo {
  user_id: string;
  full_name: string | null;
}

/**
 * Driver-facing ticket chat styled like efood Συνομιλία:
 * - Centered "received" confirmation
 * - Agent bubbles on the left with circular avatar
 * - Driver bubbles on the right (brand green)
 * - Name · time under each agent message
 */
export function DriverTicketChat({ ticketId }: { ticketId: string }) {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      const { data } = await supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (active) {
        setMessages((data ?? []) as Message[]);
        setLoading(false);
      }
    };
    load();
    const channel = supabase
      .channel(`driver-ticket-${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const incoming = payload.new as Message;
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
      supabase.removeChannel(channel);
    };
  }, [ticketId]);

  // Resolve agent display names
  useEffect(() => {
    const ids = Array.from(
      new Set(
        messages
          .filter((m) => m.sender_role === 'support' || m.sender_role === 'admin')
          .map((m) => m.sender_id)
      )
    ).filter((id) => !agents[id]);
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', ids);
      setAgents((prev) => {
        const next = { ...prev };
        (data ?? []).forEach((p: any) => {
          next[p.user_id] = { user_id: p.user_id, full_name: p.full_name };
        });
        return next;
      });
    })();
  }, [messages, agents]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const agentDisplay = (id: string) => {
    const a = agents[id];
    if (!a?.full_name) return 'Εκπρόσωπος';
    const parts = a.full_name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1][0]}.`;
  };

  const roleLabel = (role: string) => {
    switch (role) {
      case 'support': return 'Υποστήριξη';
      case 'admin': return 'Admin';
      case 'store': return 'Κατάστημα';
      case 'customer': return 'Πελάτης';
      case 'driver': return 'Οδηγός';
      default: return 'Εκπρόσωπος';
    }
  };

  const roleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-[hsl(var(--driver-accent))] text-white';
      case 'store': return 'bg-amber-500 text-white';
      case 'customer': return 'bg-blue-500 text-white';
      default: return 'bg-[hsl(var(--driver-accent))]/15 text-[hsl(var(--driver-accent))]';
    }
  };


  const driverHasSent = messages.some((m) => m.sender_role === 'driver');

  const send = async (text: string, attachment: ComposerAttachment | null) => {
    if ((!text.trim() && !attachment) || !user) return;
    const optimistic: Message = {
      id: crypto.randomUUID(),
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: 'driver',
      message: text.trim() || null,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    const { error } = await supabase.from('ticket_messages').insert({
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: 'driver',
      message: text.trim() || null,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
    } as any);
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error('Αποτυχία αποστολής');
    }
  };

  return (
    <div className="driver-shell flex flex-col h-[520px] bg-[hsl(var(--driver-bg))]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {driverHasSent && (
              <div className="flex flex-col items-center text-center text-[hsl(var(--driver-text-muted))] pt-2 pb-1">
                <CheckCircle2 className="h-5 w-5 mb-1.5 text-[hsl(var(--driver-text-muted))]" strokeWidth={1.5} />
                <p className="text-[13px]">Ο εκπρόσωπός μας έλαβε το μήνυμά σου.</p>
              </div>
            )}

            {messages.map((m, idx) => {
              const isAgent = m.sender_role === 'support' || m.sender_role === 'admin';
              const isMine = m.sender_id === user?.id;
              const prev = messages[idx - 1];
              const groupStart =
                !prev ||
                prev.sender_id !== m.sender_id ||
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

              if (!isMine) {
                return (
                  <div key={m.id} className="flex gap-2.5 items-end">
                    <div className="w-8 shrink-0 flex justify-center">
                      {groupStart ? (
                        <div className="h-8 w-8 rounded-full bg-[hsl(var(--driver-accent))] flex items-center justify-center shadow-sm">
                          <Headphones className="h-4 w-4 text-white" strokeWidth={2.25} />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-start max-w-[78%]">
                      {groupStart && (
                        <span className={`mb-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${roleBadgeClass(m.sender_role)}`}>
                          {roleLabel(m.sender_role)}
                        </span>
                      )}
                      <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-card border border-[hsl(var(--driver-border))] shadow-sm">
                        {m.attachment_url && (
                          <div className={m.message ? 'mb-1.5' : ''}>
                            <ChatAttachment url={m.attachment_url} type={m.attachment_type} />
                          </div>
                        )}
                        {m.message && (
                          <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-[hsl(var(--driver-text))]">
                            {m.message}
                          </p>
                        )}
                      </div>
                      <p className="text-[11px] text-[hsl(var(--driver-text-muted))] mt-1 px-1">
                        {agentDisplay(m.sender_id)} · {format(new Date(m.created_at), 'HH:mm')}
                      </p>
                    </div>

                  </div>
                );
              }

              // Driver's own message — right aligned, brand accent
              return (
                <div key={m.id} className="flex flex-col items-end">
                  <div className="max-w-[78%] rounded-2xl rounded-br-md px-4 py-2.5 bg-[hsl(var(--driver-accent))] text-white shadow-sm">
                    {m.attachment_url && (
                      <div className={m.message ? 'mb-1.5' : ''}>
                        <ChatAttachment url={m.attachment_url} type={m.attachment_type} />
                      </div>
                    )}
                    {m.message && (
                      <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                        {m.message}
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-[hsl(var(--driver-text-muted))] mt-1 px-1">
                    {format(new Date(m.created_at), 'HH:mm')}
                  </p>
                </div>
              );
            })}

            {messages.length === 0 && (
              <p className="text-center text-sm text-[hsl(var(--driver-text-muted))] py-12">
                Γράψε το μήνυμά σου για να ξεκινήσει η συνομιλία.
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t border-[hsl(var(--driver-border))] bg-card">
        <ChatComposer
          onSend={send}
          draft={draft}
          onDraftChange={setDraft}
          uploadFolder="tickets"
          placeholder="Γράψε το μήνυμά σου..."
          rows={1}
        />
      </div>
    </div>
  );
}
