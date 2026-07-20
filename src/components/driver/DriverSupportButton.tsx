import { useEffect, useState } from 'react';
import {
  LifeBuoy, AlertTriangle, Car, Smartphone, MessageCircle, Send,
  Package, CreditCard, Navigation as NavIcon, Phone, ChevronLeft, Headphones,
  MessagesSquare, ArrowLeft,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { DriverTicketChat } from '@/components/driver/DriverTicketChat';
import { format } from 'date-fns';

type Category = {
  key: string;
  label: string;
  hint: string;
  icon: typeof AlertTriangle;
  tone: string;
  urgent?: boolean;
};

const CATEGORIES: Category[] = [
  { key: 'emergency',      label: 'Έκτακτο',     hint: 'Ατύχημα, ασφάλεια',         icon: AlertTriangle, tone: 'bg-red-500 text-white',          urgent: true },
  { key: 'order_issue',    label: 'Παραγγελία',  hint: 'Λάθος / λείπει προϊόν',     icon: Package,       tone: 'bg-amber-500 text-white' },
  { key: 'customer_issue', label: 'Πελάτης',     hint: 'Δεν απαντάει, διεύθυνση',   icon: MessageCircle, tone: 'bg-blue-500 text-white' },
  { key: 'navigation',     label: 'Πλοήγηση',    hint: 'Λάθος διαδρομή / GPS',      icon: NavIcon,       tone: 'bg-indigo-500 text-white' },
  { key: 'vehicle_issue',  label: 'Όχημα',       hint: 'Βλάβη, καύσιμα',            icon: Car,           tone: 'bg-orange-500 text-white' },
  { key: 'payment',        label: 'Πληρωμές',    hint: 'Κέρδη, πορτοφόλι',          icon: CreditCard,    tone: 'bg-emerald-500 text-white' },
  { key: 'app_issue',      label: 'Εφαρμογή',    hint: 'Bug, σφάλμα',               icon: Smartphone,    tone: 'bg-slate-600 text-white' },
];

const SUPPORT_PHONE = '+302100000000';

const statusLabel: Record<string, { label: string; tone: string }> = {
  open: { label: 'Ανοιχτό', tone: 'bg-red-500/15 text-red-600 border-red-500/30' },
  in_progress: { label: 'Σε εξέλιξη', tone: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
  resolved: { label: 'Επιλύθηκε', tone: 'bg-green-500/15 text-green-700 border-green-500/30' },
};

interface Ticket {
  id: string;
  category: string;
  description: string | null;
  status: string;
  created_at: string;
  order_id: string | null;
}

export function DriverSupportButton({ orderId }: { orderId?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'category' | 'tickets' | 'chat'>('menu');
  const [category, setCategory] = useState<Category | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const { user } = useAuth();

  const reset = () => {
    setCategory(null);
    setDescription('');
    setActiveTicket(null);
    setView('menu');
  };

  // Load driver's tickets when opening
  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from('support_tickets')
        .select('id, category, description, status, created_at, order_id')
        .eq('driver_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (active) setTickets((data ?? []) as Ticket[]);
    };
    load();

    const channel = supabase
      .channel(`driver-tickets-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets', filter: `driver_id=eq.${user.id}` },
        () => load()
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [open, user]);

  const openCount = tickets.filter((t) => t.status !== 'resolved').length;

  const handleSubmit = async () => {
    if (!user || !category) return;
    setSubmitting(true);
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        driver_id: user.id,
        category: category.key,
        description: description || null,
        order_id: orderId || null,
      })
      .select('id, category, description, status, created_at, order_id')
      .single();
    setSubmitting(false);
    if (error || !data) {
      toast({ title: 'Σφάλμα', description: 'Αποτυχία υποβολής', variant: 'destructive' });
    } else {
      toast({ title: 'Υποβλήθηκε ✓', description: 'Ανοίξτε τη συνομιλία για άμεση επικοινωνία.' });
      setActiveTicket(data as Ticket);
      setView('chat');
      setDescription('');
      setCategory(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group relative h-10 w-10 rounded-full bg-gradient-to-br from-[hsl(var(--driver-accent))] to-[hsl(160_60%_36%)] shadow-[0_8px_20px_-6px_hsl(var(--driver-accent)/0.55)] text-white flex items-center justify-center transition-all duration-200 hover:brightness-110 hover:shadow-[0_10px_24px_-6px_hsl(var(--driver-accent)/0.7)] hover:scale-105 active:scale-95"
        aria-label="Υποστήριξη"
      >
        <Headphones className="h-5 w-5" strokeWidth={2.5} />
        {openCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[hsl(var(--driver-accent))] text-[10px] font-extrabold flex items-center justify-center shadow-sm ring-2 ring-[hsl(var(--driver-bg))]">
            {openCount}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="driver-shell max-w-md mx-auto bg-card border border-border p-0 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col rounded-2xl">
          <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-[hsl(var(--driver-accent))]/20 via-[hsl(var(--driver-accent))]/8 to-transparent border-b border-[hsl(var(--driver-border))]">
            {/* Decorative ring */}
            <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-[hsl(var(--driver-accent))]/15 blur-2xl pointer-events-none" />
            <DialogHeader className="relative">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {(view === 'category' || view === 'chat') && (
                    <button
                      onClick={() => {
                        if (view === 'chat') { setActiveTicket(null); setView('tickets'); }
                        else setView('menu');
                        setCategory(null);
                      }}
                      className="h-8 w-8 rounded-full bg-[hsl(var(--driver-bg))] border border-[hsl(var(--driver-border))] flex items-center justify-center text-[hsl(var(--driver-text-muted))] hover:text-[hsl(var(--driver-text))] hover:bg-[hsl(var(--driver-surface))] transition-colors active:scale-95"
                      aria-label="Πίσω"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  )}
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[hsl(var(--driver-accent))] to-[hsl(160_60%_38%)] flex items-center justify-center shadow-md shrink-0">
                    <LifeBuoy className="h-5 w-5 text-white" strokeWidth={2.25} />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="font-heading text-[15px] font-bold text-[hsl(var(--driver-text))] leading-tight">
                      {view === 'chat' && activeTicket
                        ? `Ticket #${activeTicket.id.slice(0, 6).toUpperCase()}`
                        : view === 'tickets'
                        ? 'Οι Συνομιλίες μου'
                        : 'Υποστήριξη Οδηγών'}
                    </DialogTitle>
                    <DialogDescription className="text-[11px] text-[hsl(var(--driver-text-muted))] mt-0.5 leading-snug">
                      {view === 'category' && category
                        ? category.hint
                        : view === 'chat'
                        ? 'Συνομιλία σε πραγματικό χρόνο'
                        : 'Διαθέσιμοι 24/7 · μέσος χρόνος < 5 λ'}
                    </DialogDescription>
                  </div>
                </div>
                <div className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <span className="text-[9px] font-heading font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Live
                  </span>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-5 overflow-y-auto flex-1">
            {view === 'menu' && (
              <>
                <a
                  href={`tel:${SUPPORT_PHONE}`}
                  className="flex items-center gap-3 p-3 mb-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/15 transition-colors"
                >
                  <span className="h-10 w-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
                    <Phone className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">Άμεση Κλήση</p>
                    <p className="text-[11px] text-[hsl(var(--driver-text-muted))]">Μέσος χρόνος αναμονής 30s</p>
                  </div>
                </a>

                {tickets.length > 0 && (
                  <button
                    onClick={() => setView('tickets')}
                    className="w-full flex items-center gap-3 p-3 mb-4 rounded-xl bg-[hsl(var(--driver-accent))]/10 border border-[hsl(var(--driver-accent))]/30 hover:bg-[hsl(var(--driver-accent))]/15 transition-colors"
                  >
                    <span className="h-10 w-10 rounded-full bg-[hsl(var(--driver-accent))] text-white flex items-center justify-center shadow-md">
                      <MessagesSquare className="h-5 w-5" />
                    </span>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">
                        Οι Συνομιλίες μου
                        {openCount > 0 && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white">{openCount} ενεργές</span>
                        )}
                      </p>
                      <p className="text-[11px] text-[hsl(var(--driver-text-muted))]">Δείτε & απαντήστε σε ανοιχτά tickets</p>
                    </div>
                  </button>
                )}

                <p className="text-[10px] uppercase tracking-wider font-heading font-bold text-[hsl(var(--driver-text-muted))] mb-2 px-1">
                  Νέο Αίτημα
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.key}
                        onClick={() => { setCategory(cat); setView('category'); }}
                        className={`group relative flex flex-col items-start gap-2 p-3 rounded-xl border bg-[hsl(var(--driver-bg))] border-[hsl(var(--driver-border))] hover:border-[hsl(var(--driver-accent))]/50 transition-all active:scale-[0.97] text-left ${cat.urgent ? 'ring-1 ring-red-500/30' : ''}`}
                      >
                        <span className={`h-9 w-9 rounded-lg flex items-center justify-center shadow-md ${cat.tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-heading font-bold text-xs text-[hsl(var(--driver-text))] leading-tight">{cat.label}</p>
                          <p className="text-[10px] text-[hsl(var(--driver-text-muted))] leading-tight mt-0.5">{cat.hint}</p>
                        </div>
                        {cat.urgent && (
                          <span className="absolute top-2 right-2 text-[8px] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-red-500 text-white">SOS</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {orderId && (
                  <div className="mt-4 flex items-center gap-2 p-2.5 rounded-lg bg-[hsl(var(--driver-bg))] border border-[hsl(var(--driver-border))]">
                    <Package className="h-3.5 w-3.5 text-[hsl(var(--driver-accent))]" />
                    <span className="text-[10px] font-heading text-[hsl(var(--driver-text-muted))]">
                      Ενεργή παραγγελία <span className="font-bold text-[hsl(var(--driver-text))]">#{orderId.slice(0, 6)}</span>
                    </span>
                  </div>
                )}
              </>
            )}

            {view === 'tickets' && (
              <div className="space-y-2">
                {tickets.length === 0 ? (
                  <p className="text-center text-xs text-[hsl(var(--driver-text-muted))] py-8">
                    Δεν έχετε υποβάλει tickets ακόμα.
                  </p>
                ) : (
                  tickets.map((t) => {
                    const cat = CATEGORIES.find((c) => c.key === t.category);
                    const Icon = cat?.icon ?? MessageCircle;
                    const sl = statusLabel[t.status] ?? statusLabel.open;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setActiveTicket(t); setView('chat'); }}
                        className="w-full flex items-start gap-2.5 p-2.5 rounded-lg bg-[hsl(var(--driver-bg))] border border-[hsl(var(--driver-border))] hover:border-[hsl(var(--driver-accent))]/50 transition-all text-left"
                      >
                        <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${cat?.tone ?? 'bg-muted text-foreground'}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-heading font-bold text-xs text-[hsl(var(--driver-text))] truncate">
                              {cat?.label ?? t.category}
                            </p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${sl.tone}`}>{sl.label}</span>
                          </div>
                          {t.description && (
                            <p className="text-[10px] text-[hsl(var(--driver-text-muted))] line-clamp-1 mt-0.5">{t.description}</p>
                          )}
                          <p className="text-[9px] text-[hsl(var(--driver-text-muted))] mt-0.5">
                            {format(new Date(t.created_at), 'dd MMM, HH:mm')}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {view === 'category' && category && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[hsl(var(--driver-bg))] border border-[hsl(var(--driver-border))]">
                  <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${category.tone}`}>
                    <category.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-heading font-bold text-xs text-[hsl(var(--driver-text))]">{category.label}</p>
                    <p className="text-[10px] text-[hsl(var(--driver-text-muted))]">{category.hint}</p>
                  </div>
                </div>

                <Textarea
                  placeholder="Περιγράψτε το πρόβλημά σας με λεπτομέρεια..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="bg-[hsl(var(--driver-bg))] border-[hsl(var(--driver-border))] text-[hsl(var(--driver-text))] focus:ring-[hsl(var(--driver-accent))] resize-none"
                />

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full h-12 rounded-xl font-heading font-bold text-sm bg-[hsl(var(--driver-accent))] text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all shadow-lg shadow-[hsl(var(--driver-accent))]/30"
                >
                  <Send className="h-4 w-4" />
                  {submitting ? 'Αποστολή...' : 'Υποβολή & Άνοιγμα Συνομιλίας'}
                </button>

                <p className="text-[10px] text-center text-[hsl(var(--driver-text-muted))]">
                  Μέσος χρόνος απάντησης: <span className="font-bold text-[hsl(var(--driver-accent))]">{'< 5 λεπτά'}</span>
                </p>
              </div>
            )}

            {view === 'chat' && activeTicket && (
              <DriverTicketChat ticketId={activeTicket.id} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
