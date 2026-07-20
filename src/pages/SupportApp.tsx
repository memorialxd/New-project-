import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Headphones, AlertTriangle, Clock, CheckCircle, LogOut, MessageSquare, ArrowLeft, Car, Smartphone, Phone, Copy, Hash, Zap, AlarmClock, Flag, Siren } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TicketChat, type TicketChatHandle } from '@/components/support/TicketChat';
import { SupportAIPanel } from '@/components/support/SupportAIPanel';

import { SupportActionToolbox } from '@/components/support/SupportActionToolbox';
import DeliveryControlCenter from '@/components/admin/DeliveryControlCenter';
import { DriverProfilePanel } from '@/components/support/DriverProfilePanel';
import { CustomerProfilePanel } from '@/components/support/CustomerProfilePanel';
import { SlaSettingsPanel } from '@/components/support/SlaSettingsPanel';
import { TeamChat } from '@/components/support/TeamChat';
import AnnouncementsBanner from '@/components/AnnouncementsBanner';
import { Users } from 'lucide-react';
import { type TicketPriority } from '@/hooks/useSlaSettings';
import { toast } from 'sonner';
import { format, differenceInMinutes } from 'date-fns';

const QUICK_REPLIES = [
  { label: 'Καλωσόρισμα', text: 'Γεια σας! Είμαι εδώ για να βοηθήσω. Πείτε μου τι συμβαίνει;' },
  { label: 'Σε αναμονή', text: 'Σας παρακαλώ περιμένετε λίγο, ελέγχω την κατάσταση...' },
  { label: 'Αναφορά καταστήματος', text: 'Έχω ενημερώσει το κατάστημα σχετικά με το θέμα. Θα σας ενημερώσω σύντομα.' },
  { label: 'Επικοινωνία πελάτη', text: 'Δοκιμάστε να καλέσετε ξανά τον πελάτη. Αν δεν απαντήσει σε 5 λεπτά, ενημερώστε με.' },
  { label: 'Κλείσιμο', text: 'Χαίρομαι που βοηθήσαμε! Καλή συνέχεια στη βάρδιά σας 🙌' },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  open: { label: 'Ανοιχτό', color: 'bg-red-500/10 text-red-600 border-red-500/20' },
  in_progress: { label: 'Σε εξέλιξη', color: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
  resolved: { label: 'Επιλύθηκε', color: 'bg-green-500/10 text-green-700 border-green-500/20' },
};

const PRIORITY_ORDER: Record<string, number> = { sos: 0, high: 1, normal: 2, low: 3 };
const priorityConfig: Record<TicketPriority, { label: string; color: string; icon: any }> = {
  sos: { label: 'SOS', color: 'bg-red-600 text-white border-red-700 animate-pulse', icon: Siren },
  high: { label: 'Υψηλή', color: 'bg-orange-500/15 text-orange-700 border-orange-500/30', icon: Flag },
  normal: { label: 'Κανονική', color: 'bg-muted text-muted-foreground border-border', icon: Flag },
  low: { label: 'Χαμηλή', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20', icon: Flag },
};

const categoryConfig: Record<string, { label: string; icon: any; color: string }> = {
  emergency: { label: 'Έκτακτο', icon: AlertTriangle, color: 'text-red-500' },
  customer_issue: { label: 'Πελάτης', icon: MessageSquare, color: 'text-blue-500' },
  vehicle_issue: { label: 'Όχημα', icon: Car, color: 'text-orange-500' },
  app_issue: { label: 'Εφαρμογή', icon: Smartphone, color: 'text-muted-foreground' },
  long_wait: { label: 'Μεγάλη Αναμονή', icon: Clock, color: 'text-yellow-500' },
  wrong_address: { label: 'Λάθος Διεύθυνση', icon: AlertTriangle, color: 'text-orange-500' },
  payment: { label: 'Πληρωμή', icon: AlertTriangle, color: 'text-purple-500' },
  accident: { label: 'Ατύχημα', icon: AlertTriangle, color: 'text-red-600' },
  other: { label: 'Άλλο', icon: MessageSquare, color: 'text-muted-foreground' },
};

export default function SupportApp() {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'in_progress' | 'resolved' | 'all'>('open');
  const [activeTicket, setActiveTicket] = useState<any | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [view, setView] = useState<'tickets' | 'team' | 'dcc'>('tickets');
  const chatRef = useRef<TicketChatHandle>(null);

  const { data: tickets } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['support-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('user_id, full_name, phone');
      return data ?? [];
    },
  });

  // Realtime: refresh on new tickets
  useEffect(() => {
    const channel = supabase
      .channel('support-tickets-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const driverInfo = (id: string) => profiles?.find((p) => p.user_id === id);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('support_tickets').update({ status }).eq('id', id);
    if (error) toast.error('Αποτυχία');
    else {
      toast.success('Ενημερώθηκε');
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      if (activeTicket?.id === id) setActiveTicket({ ...activeTicket, status });
    }
  };

  const updatePriority = async (id: string, priority: TicketPriority) => {
    const { error } = await supabase.from('support_tickets').update({ priority } as any).eq('id', id);
    if (error) toast.error('Αποτυχία προτεραιότητας');
    else {
      toast.success('Προτεραιότητα ενημερώθηκε');
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      if (activeTicket?.id === id) setActiveTicket({ ...activeTicket, priority });
    }
  };

  const resolve = async () => {
    if (!activeTicket) return;
    const { error } = await supabase
      .from('support_tickets')
      .update({ status: 'resolved', resolution_notes: resolutionNotes })
      .eq('id', activeTicket.id);
    if (error) toast.error('Αποτυχία');
    else {
      toast.success('Επιλύθηκε');
      setResolveOpen(false);
      setResolutionNotes('');
      setActiveTicket({ ...activeTicket, status: 'resolved', resolution_notes: resolutionNotes });
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const filtered = (tickets?.filter((t) => statusFilter === 'all' || t.status === statusFilter) ?? [])
    .slice()
    .sort((a: any, b: any) => {
      const pa = PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2;
      const pb = PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const counts = {
    open: tickets?.filter((t) => t.status === 'open').length ?? 0,
    in_progress: tickets?.filter((t) => t.status === 'in_progress').length ?? 0,
    resolved: tickets?.filter((t) => t.status === 'resolved').length ?? 0,
  };

  // Detail view
  if (activeTicket) {
    const driver = driverInfo(activeTicket.driver_id);
    const cat = categoryConfig[activeTicket.category] ?? categoryConfig.other;
    const CatIcon = cat.icon;
    const cfg = statusConfig[activeTicket.status] ?? statusConfig.open;
    const currentPriority: TicketPriority = (activeTicket.priority ?? 'normal') as TicketPriority;
    const pcfg = priorityConfig[currentPriority];
    const PIcon = pcfg.icon;

    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-10 bg-card border-b px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setActiveTicket(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-semibold truncate">
              {driver?.full_name ?? (activeTicket.driver_id ? activeTicket.driver_id.slice(0, 8) : 'Άγνωστος')}
            </p>
            <p className="text-xs text-muted-foreground">Ticket #{activeTicket.id?.slice(0, 8) ?? '—'}</p>
          </div>
          <Badge variant="outline" className={`${pcfg.color} text-[10px] gap-1`}>
            <PIcon className="h-3 w-3" /> {pcfg.label}
          </Badge>
          <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
        </header>

        <div className="p-4 max-w-3xl mx-auto space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center ${cat.color}`}>
                  <CatIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-semibold">{cat.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(activeTicket.created_at), 'dd MMM yyyy, HH:mm')}
                    {driver?.phone && ` · 📞 ${driver.phone}`}
                  </p>
                </div>
              </div>
              {activeTicket.description && (
                <p className="text-sm bg-muted/50 rounded-lg p-3">{activeTicket.description}</p>
              )}
              {activeTicket.order_id && (
                <p className="text-xs text-muted-foreground">Σχετική παραγγελία: #{activeTicket.order_id.slice(0, 8)}</p>
              )}
              {activeTicket.status === 'resolved' && activeTicket.resolution_notes && (
                <div className="text-sm bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                  <p className="text-xs font-semibold text-green-700 mb-1">Επίλυση</p>
                  <p>{activeTicket.resolution_notes}</p>
                </div>
              )}
              {activeTicket.status !== 'resolved' && (
                <div className="flex gap-2 pt-2 border-t flex-wrap items-center">
                  <Select value={currentPriority} onValueChange={(v) => updatePriority(activeTicket.id, v as TicketPriority)}>
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sos">🚨 SOS</SelectItem>
                      <SelectItem value="high">🚩 Υψηλή</SelectItem>
                      <SelectItem value="normal">⚪ Κανονική</SelectItem>
                      <SelectItem value="low">🟦 Χαμηλή</SelectItem>
                    </SelectContent>
                  </Select>
                  {activeTicket.status === 'open' && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus(activeTicket.id, 'in_progress')}>
                      <Clock className="h-4 w-4 mr-1" /> Σε εξέλιξη
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setResolveOpen(true)}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Επίλυση
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {(activeTicket.requester_role === 'customer' || activeTicket.requester_role === 'store') && activeTicket.requester_id ? (
            <CustomerProfilePanel userId={activeTicket.requester_id} />
          ) : activeTicket.driver_id ? (
            <DriverProfilePanel driverId={activeTicket.driver_id} />
          ) : null}


          {activeTicket.driver_id && (
            <SupportActionToolbox
              ticket={activeTicket}
              driver={driver}
              onDriverChanged={() => queryClient.invalidateQueries({ queryKey: ['support-driver-profile', activeTicket.driver_id] })}
            />
          )}

          {/* Agent Toolbox */}
          <Card>
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide font-heading font-bold text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" /> Εργαλεία Agent
                </p>
                <span className="text-[10px] flex items-center gap-1 text-muted-foreground">
                  <AlarmClock className="h-3 w-3" />
                  Ηλικία: {differenceInMinutes(new Date(), new Date(activeTicket.created_at))}λ
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {driver?.phone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    asChild
                  >
                    <a href={`tel:${driver.phone}`}>
                      <Phone className="h-3 w-3 mr-1" /> Κλήση οδηγού
                    </a>
                  </Button>
                )}
                {driver?.phone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      navigator.clipboard.writeText(driver.phone!);
                      toast.success('Τηλέφωνο αντιγράφηκε');
                    }}
                  >
                    <Copy className="h-3 w-3 mr-1" /> Αντιγραφή τηλ.
                  </Button>
                )}
                {activeTicket.order_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      navigator.clipboard.writeText(activeTicket.order_id);
                      toast.success('Order ID αντιγράφηκε');
                    }}
                  >
                    <Hash className="h-3 w-3 mr-1" /> Order #{activeTicket.order_id.slice(0, 6)}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    navigator.clipboard.writeText(activeTicket.id);
                    toast.success('Ticket ID αντιγράφηκε');
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Ticket ID
                </Button>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide font-heading font-bold text-muted-foreground mb-1.5">
                  Γρήγορες απαντήσεις
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => chatRef.current?.setDraft(q.text)}
                      className="text-[11px] px-2 py-1 rounded-md border bg-muted/40 hover:bg-muted transition-colors"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <SupportAIPanel
            ticketId={activeTicket.id}
            onUseReply={(text) => chatRef.current?.setDraft(text)}
          />

          <div>
            <h3 className="font-heading font-semibold text-sm mb-2 px-1">Συνομιλία</h3>
            <TicketChat ref={chatRef} ticketId={activeTicket.id} priority={currentPriority} />
          </div>
        </div>

        <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Επίλυση Ticket</DialogTitle>
            </DialogHeader>
            <Textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Σημειώσεις επίλυσης..."
              rows={4}
            />
            <Button onClick={resolve}>Αποθήκευση & Επίλυση</Button>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // List view
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card border-b px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Headphones className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-heading font-bold leading-tight">Support</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{profile?.full_name ?? 'Agent'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => setView('tickets')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              view === 'tickets' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Tickets
          </button>
          <button
            onClick={() => setView('team')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              view === 'team' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="h-3.5 w-3.5" /> Ομάδα
          </button>
          <button
            onClick={() => setView('dcc')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              view === 'dcc' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Zap className="h-3.5 w-3.5" /> Control
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => navigate('/profile')} title="Το προφίλ μου">
            <Headphones className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleSignOut} title="Αποσύνδεση">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {view === 'team' ? (
        <div className="p-4 max-w-7xl mx-auto space-y-4">
          <AnnouncementsBanner audience="support" />
          <TeamChat />
        </div>
      ) : view === 'dcc' ? (
        <div className="p-4 max-w-7xl mx-auto space-y-4">
          <AnnouncementsBanner audience="support" />
          <DeliveryControlCenter />
        </div>
      ) : (

      <div className="p-4 space-y-4 max-w-3xl mx-auto">
        <AnnouncementsBanner audience="support" />
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setStatusFilter('open')}
            className={`rounded-xl p-3 border text-left transition-colors ${
              statusFilter === 'open' ? 'bg-red-500/10 border-red-500/40' : 'bg-card hover:bg-muted/40'
            }`}
          >
            <AlertTriangle className="h-5 w-5 text-red-500 mb-1" />
            <p className="text-xs text-muted-foreground">Ανοιχτά</p>
            <p className="font-heading font-bold text-xl">{counts.open}</p>
          </button>
          <button
            onClick={() => setStatusFilter('in_progress')}
            className={`rounded-xl p-3 border text-left transition-colors ${
              statusFilter === 'in_progress' ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-card hover:bg-muted/40'
            }`}
          >
            <Clock className="h-5 w-5 text-yellow-500 mb-1" />
            <p className="text-xs text-muted-foreground">Σε εξέλιξη</p>
            <p className="font-heading font-bold text-xl">{counts.in_progress}</p>
          </button>
          <button
            onClick={() => setStatusFilter('resolved')}
            className={`rounded-xl p-3 border text-left transition-colors ${
              statusFilter === 'resolved' ? 'bg-green-500/10 border-green-500/40' : 'bg-card hover:bg-muted/40'
            }`}
          >
            <CheckCircle className="h-5 w-5 text-green-500 mb-1" />
            <p className="text-xs text-muted-foreground">Επιλυμένα</p>
            <p className="font-heading font-bold text-xl">{counts.resolved}</p>
          </button>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant={statusFilter === 'all' ? 'default' : 'outline'} onClick={() => setStatusFilter('all')}>
            Όλα
          </Button>
        </div>

        <SlaSettingsPanel />

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                Δεν υπάρχουν tickets σε αυτή την κατηγορία.
              </CardContent>
            </Card>
          ) : (
            filtered.map((ticket) => {
              const driver = driverInfo(ticket.driver_id);
              const cat = categoryConfig[ticket.category] ?? categoryConfig.other;
              const CatIcon = cat.icon;
              const cfg = statusConfig[ticket.status] ?? statusConfig.open;
              return (
                <button
                  key={ticket.id}
                  onClick={() => setActiveTicket(ticket)}
                  className="w-full text-left"
                >
                  <Card className="hover:bg-muted/40 transition-colors">
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0 ${cat.color}`}>
                        <CatIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-heading font-semibold text-sm truncate">
                            {driver?.full_name ?? (ticket.driver_id ? ticket.driver_id.slice(0, 8) : 'Άγνωστος')}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            {(() => {
                              const pri = (ticket.priority ?? 'normal') as TicketPriority;
                              const pp = priorityConfig[pri];
                              const PI = pp.icon;
                              if (pri === 'normal') return null;
                              return (
                                <Badge variant="outline" className={`${pp.color} text-[10px] gap-0.5 px-1.5`}>
                                  <PI className="h-2.5 w-2.5" />{pp.label}
                                </Badge>
                              );
                            })()}
                            <Badge variant="outline" className={`${cfg.color} text-[10px]`}>{cfg.label}</Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{cat.label}</p>
                        {ticket.description && (
                          <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{ticket.description}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {format(new Date(ticket.created_at), 'dd MMM, HH:mm')}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            })
          )}
        </div>
      </div>
      )}
    </div>
  );
}
