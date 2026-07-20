import { useEffect, useState } from 'react';
import {
  LifeBuoy, AlertTriangle, Smartphone, MessageCircle, Send,
  Package, CreditCard, Phone, Headphones, MessagesSquare, ArrowLeft,
  ChefHat, Bike,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { TicketChat } from '@/components/support/TicketChat';
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
  { key: 'emergency',      label: 'Έκτακτο',      hint: 'Άμεσο πρόβλημα',          icon: AlertTriangle, tone: 'bg-red-500 text-white', urgent: true },
  { key: 'order_issue',    label: 'Παραγγελία',   hint: 'Πρόβλημα παραγγελίας',    icon: Package,       tone: 'bg-amber-500 text-white' },
  { key: 'driver_issue',   label: 'Οδηγός',       hint: 'Δεν ήρθε / αργεί',        icon: Bike,          tone: 'bg-indigo-500 text-white' },
  { key: 'kitchen_issue',  label: 'Κουζίνα',      hint: 'Καθυστέρηση ετοιμασίας',  icon: ChefHat,       tone: 'bg-orange-500 text-white' },
  { key: 'customer_issue', label: 'Πελάτης',      hint: 'Παράπονο / επιστροφή',    icon: MessageCircle, tone: 'bg-blue-500 text-white' },
  { key: 'payment',        label: 'Πληρωμές',     hint: 'Προμήθειες, εισπράξεις',  icon: CreditCard,    tone: 'bg-emerald-500 text-white' },
  { key: 'app_issue',      label: 'Εφαρμογή',     hint: 'Bug, σφάλμα',             icon: Smartphone,    tone: 'bg-slate-600 text-white' },
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

interface StoreSupportButtonProps {
  storeId?: string;
  orderId?: string;
}

export function StoreSupportButton({ orderId }: StoreSupportButtonProps) {
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

  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    const load = async () => {
      const { data } = await (supabase as any)
        .from('support_tickets')
        .select('id, category, description, status, created_at, order_id')
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (active) setTickets((data ?? []) as Ticket[]);
    };
    load();
    const ch = supabase
      .channel(`store-tickets-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets', filter: `requester_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [open, user]);

  const openCount = tickets.filter((t) => t.status !== 'resolved').length;

  const handleSubmit = async () => {
    if (!user || !category) return;
    setSubmitting(true);
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        driver_id: null,
        requester_id: user.id,
        requester_role: 'store',
        category: category.key,
        description: description || null,
        order_id: orderId || null,
      } as any)
      .select('id, category, description, status, created_at, order_id')
      .single();
    setSubmitting(false);
    if (error || !data) {
      toast({ title: 'Σφάλμα', description: error?.message ?? 'Αποτυχία υποβολής', variant: 'destructive' });
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
        className="relative h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary/70 shadow-primary text-primary-foreground flex items-center justify-center transition-all hover:brightness-110 active:scale-95"
        aria-label="Υποστήριξη"
      >
        <Headphones className="h-5 w-5" strokeWidth={2.25} />
        {openCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-card">
            {openCount}
          </span>
        ) : (
          <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-card animate-pulse" />
        )}
      </button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-md mx-auto p-0 overflow-hidden max-h-[92vh] flex flex-col">
          <div className="px-5 pt-5 pb-3 bg-gradient-to-br from-primary/15 to-transparent border-b">
            <DialogHeader>
              <DialogTitle className="font-heading text-lg flex items-center gap-2">
                {(view === 'category' || view === 'chat') && (
                  <button
                    onClick={() => {
                      if (view === 'chat') { setActiveTicket(null); setView('tickets'); }
                      else setView('menu');
                      setCategory(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <LifeBuoy className="h-5 w-5 text-primary" />
                {view === 'chat' && activeTicket
                  ? `Ticket #${activeTicket.id.slice(0, 6)}`
                  : view === 'tickets'
                  ? 'Οι Συνομιλίες μου'
                  : 'Υποστήριξη Καταστήματος'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {view === 'category' && category
                  ? category.hint
                  : view === 'chat'
                  ? 'Συνομιλία σε πραγματικό χρόνο με την υποστήριξη'
                  : 'Διαθέσιμοι 24/7 για άμεση βοήθεια.'}
              </DialogDescription>
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
                    <p className="font-heading font-bold text-sm">Άμεση Κλήση</p>
                    <p className="text-[11px] text-muted-foreground">Μέσος χρόνος αναμονής 30s</p>
                  </div>
                </a>

                {tickets.length > 0 && (
                  <button
                    onClick={() => setView('tickets')}
                    className="w-full flex items-center gap-3 p-3 mb-4 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/15 transition-colors"
                  >
                    <span className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md">
                      <MessagesSquare className="h-5 w-5" />
                    </span>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-heading font-bold text-sm">
                        Οι Συνομιλίες μου
                        {openCount > 0 && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white">{openCount} ενεργές</span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">Δείτε & απαντήστε σε ανοιχτά tickets</p>
                    </div>
                  </button>
                )}

                <p className="text-[10px] uppercase tracking-wider font-heading font-bold text-muted-foreground mb-2 px-1">
                  Νέο Αίτημα
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.key}
                        onClick={() => { setCategory(cat); setView('category'); }}
                        className={`group relative flex flex-col items-start gap-2 p-3 rounded-xl border bg-card hover:border-primary/50 transition-all active:scale-[0.97] text-left ${cat.urgent ? 'ring-1 ring-red-500/30' : ''}`}
                      >
                        <span className={`h-9 w-9 rounded-lg flex items-center justify-center shadow-md ${cat.tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-heading font-bold text-xs leading-tight">{cat.label}</p>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{cat.hint}</p>
                        </div>
                        {cat.urgent && (
                          <span className="absolute top-2 right-2 text-[8px] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-red-500 text-white">SOS</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {orderId && (
                  <div className="mt-4 flex items-center gap-2 p-2.5 rounded-lg bg-muted">
                    <Package className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-heading text-muted-foreground">
                      Ενεργή παραγγελία <span className="font-bold text-foreground">#{orderId.slice(0, 6)}</span>
                    </span>
                  </div>
                )}
              </>
            )}

            {view === 'tickets' && (
              <div className="space-y-2">
                {tickets.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-8">
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
                        className="w-full flex items-start gap-2.5 p-2.5 rounded-lg bg-card border hover:border-primary/50 transition-all text-left"
                      >
                        <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${cat?.tone ?? 'bg-muted text-foreground'}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-heading font-bold text-xs truncate">{cat?.label ?? t.category}</p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${sl.tone}`}>{sl.label}</span>
                          </div>
                          {t.description && (
                            <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{t.description}</p>
                          )}
                          <p className="text-[9px] text-muted-foreground mt-0.5">
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
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted">
                  <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${category.tone}`}>
                    <category.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-heading font-bold text-xs">{category.label}</p>
                    <p className="text-[10px] text-muted-foreground">{category.hint}</p>
                  </div>
                </div>

                <Textarea
                  placeholder="Περιγράψτε το πρόβλημά σας με λεπτομέρεια..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="resize-none"
                />

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full h-12 rounded-xl font-heading font-bold text-sm bg-primary text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all shadow-lg"
                >
                  <Send className="h-4 w-4" />
                  {submitting ? 'Αποστολή...' : 'Υποβολή & Άνοιγμα Συνομιλίας'}
                </button>

                <p className="text-[10px] text-center text-muted-foreground">
                  Μέσος χρόνος απάντησης: <span className="font-bold text-primary">{'< 5 λεπτά'}</span>
                </p>
              </div>
            )}

            {view === 'chat' && activeTicket && (
              <TicketChat ticketId={activeTicket.id} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
