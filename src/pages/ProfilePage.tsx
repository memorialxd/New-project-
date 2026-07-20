import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, User, Mail, Phone, Save, Loader2, Shield, Car, Store,
  Headphones, ShoppingBag, LogOut, Languages, Palette, Pencil,
  FileText, RefreshCw, Ticket, Gift, MapPin, Heart, Receipt, ChevronRight,
  Settings as SettingsIcon, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SEO } from '@/components/SEO';
import { SavedAddresses } from '@/components/SavedAddresses';
import { CustomerReferralCard } from '@/components/customer/CustomerReferralCard';
import { CustomerWalletCard } from '@/components/customer/CustomerWalletCard';

const roleConfig: Record<string, { label: string; icon: any; path: string }> = {
  admin:    { label: 'Admin',     icon: Shield,      path: '/admin'   },
  support:  { label: 'Support',   icon: Headphones,  path: '/support' },
  driver:   { label: 'Οδηγός',    icon: Car,         path: '/driver'  },
  store:    { label: 'Κατάστημα', icon: Store,       path: '/store'   },
  customer: { label: 'Πελάτης',   icon: ShoppingBag, path: '/order'   },
};

export default function ProfilePage() {
  const { user, profile, isAdmin, isSupport, signOut } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sheet, setSheet] = useState<null | 'addresses' | 'referral' | 'wallet'>(null);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    setFullName(profile?.full_name ?? '');
    (async () => {
      const { data } = await supabase.from('profiles').select('phone').eq('user_id', user.id).single();
      setPhone(data?.phone ?? '');
    })();
  }, [user, profile, navigate]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName || null, phone: phone || null })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Το προφίλ ενημερώθηκε');
    setEditOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  // Roles
  const availableRoles: string[] = [];
  if (isAdmin) availableRoles.push('admin');
  if (isSupport || isAdmin) availableRoles.push('support');
  if (isAdmin) {
    availableRoles.push('driver', 'store', 'customer');
  } else if (profile?.role) {
    if (!availableRoles.includes(profile.role)) availableRoles.push(profile.role);
    if (profile.role !== 'customer') availableRoles.push('customer');
  }
  const activeRole = isAdmin ? 'admin' : (profile?.role ?? 'customer');

  if (!user) return null;

  const initials = (fullName || user.email || '?').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-muted/40">
      <SEO
        title="Το προφίλ μου — Fresh Delivery"
        description="Διαχειριστείτε τα στοιχεία λογαριασμού, τις διευθύνσεις και τις προτιμήσεις σας στο Fresh Delivery."
        path="/profile"
        noindex
      />

      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="container max-w-2xl flex items-center justify-between px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Πίσω">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-heading font-bold text-base text-foreground">Το Προφίλ μου</h1>
          <Sheet open={editOpen} onOpenChange={setEditOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Επεξεργασία">
                <SettingsIcon className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl">
              <SheetHeader>
                <SheetTitle className="font-heading text-left">Στοιχεία λογαριασμού</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Ονοματεπώνυμο</Label>
                  <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Τηλέφωνο</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} className="pl-9" placeholder="+30..." />
                  </div>
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Αποθήκευση
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="container max-w-2xl px-5 pt-6 pb-16 space-y-8">
        {/* Identity */}
        <section className="flex flex-col items-center text-center">
          <div className="relative">
            <div className="h-24 w-24 rounded-full gradient-primary border-4 border-card shadow-lg flex items-center justify-center text-primary-foreground font-heading font-bold text-3xl">
              {initials}
            </div>
            <button
              onClick={() => setEditOpen(true)}
              className="absolute bottom-0 right-0 p-1.5 bg-foreground text-background rounded-full border-2 border-card shadow-sm hover:opacity-90 transition"
              aria-label="Επεξεργασία προφίλ"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
          <h2 className="mt-4 font-heading font-bold text-xl text-foreground">{fullName || 'Χρήστης'}</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
            <Mail className="h-3 w-3" /> {user.email}
          </p>
          {phone && (
            <p className="text-xs text-muted-foreground mt-1">{phone}</p>
          )}
        </section>

        {/* Role switcher (admin/multi-role only) */}
        {availableRoles.length > 1 && (
          <section>
            <div className="bg-muted p-1 rounded-xl flex gap-1 overflow-x-auto scrollbar-none">
              {availableRoles.map(r => {
                const cfg = roleConfig[r];
                if (!cfg) return null;
                const Icon = cfg.icon;
                const isActive = r === activeRole;
                return (
                  <button
                    key={r}
                    onClick={() => navigate(cfg.path)}
                    className={`flex-1 min-w-fit px-3 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-1.5 ${
                      isActive
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Primary tiles */}
        <section className="grid grid-cols-2 gap-3">
          <TileButton to="/orders" icon={Receipt} tone="primary" label="Παραγγελίες μου" hint="Ιστορικό & επανάληψη" />
          <TileAction onClick={() => setSheet('wallet')} icon={Ticket} tone="emerald" label="Κουπόνια" hint="Υπόλοιπο & κινήσεις" />
        </section>

        {/* Perks & Social */}
        <section>
          <SectionTitle>Ανταμοιβές & Προσκλήσεις</SectionTitle>
          <Group>
            <RowAction onClick={() => setSheet('referral')} icon={Heart} iconTone="rose" label="Κάλεσε φίλους" trailing={<Badge className="bg-primary/10 text-primary border-0 hover:bg-primary/10">Κέρδισε 5€</Badge>} />
          </Group>
        </section>

        {/* Preferences */}
        <section>
          <SectionTitle>Προτιμήσεις</SectionTitle>
          <Group>
            <RowAction onClick={() => setSheet('addresses')} icon={MapPin} iconTone="muted" label="Διευθύνσεις" trailing={<Chevron />} />
            <RowInline icon={Languages} iconTone="muted" label="Γλώσσα" trailing={<LanguageToggle />} />
            <RowInline icon={Palette} iconTone="muted" label="Θέμα" trailing={<ThemeToggle />} />
          </Group>
        </section>

        {/* Legal */}
        <section>
          <SectionTitle>Νομικά</SectionTitle>
          <Group>
            <Row to="/legal/terms" icon={FileText} iconTone="muted" label="Όροι Χρήσης" trailing={<Chevron />} />
            <Row to="/legal/privacy" icon={Shield} iconTone="muted" label="Πολιτική Απορρήτου" trailing={<Chevron />} />
            <Row to="/legal/refunds" icon={RefreshCw} iconTone="muted" label="Πολιτική Επιστροφών" trailing={<Chevron />} />
          </Group>
        </section>

        {/* Sign out */}
        <div className="pt-2">
          <button
            onClick={handleSignOut}
            className="w-full py-4 bg-muted text-muted-foreground font-bold text-sm rounded-xl border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Αποσύνδεση
          </button>
          <p className="mt-4 text-center text-[10px] text-muted-foreground uppercase tracking-wider">Fresh Delivery · v2.4</p>
        </div>
      </main>

      {/* Sub-sheets: Wallet / Referral / Addresses */}
      <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-heading text-left">
              {sheet === 'wallet' && 'Κουπόνια'}
              {sheet === 'referral' && 'Κάλεσε φίλους'}
              {sheet === 'addresses' && 'Οι διευθύνσεις μου'}
            </SheetTitle>
          </SheetHeader>
          <div className="pt-4">
            {sheet === 'wallet' && <CustomerWalletCard />}
            {sheet === 'referral' && <CustomerReferralCard />}
            {sheet === 'addresses' && (
              <SavedAddresses onSelect={() => setSheet(null)} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em] px-1 mb-2">
      {children}
    </h3>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border shadow-sm">
      {children}
    </div>
  );
}

function Chevron() {
  return <ChevronRight className="h-4 w-4 text-muted-foreground/60" />;
}

const toneClasses: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber:   'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rose:    'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  muted:   'bg-muted text-muted-foreground',
};

function Row({
  to, icon: Icon, iconTone = 'muted', label, trailing,
}: {
  to: string; icon: React.ElementType; iconTone?: keyof typeof toneClasses | string;
  label: string; trailing?: React.ReactNode;
}) {
  return (
    <Link to={to} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-muted/40 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[iconTone] ?? toneClasses.muted}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>
      <div className="shrink-0 flex items-center gap-2">{trailing}</div>
    </Link>
  );
}

function RowInline({
  icon: Icon, iconTone = 'muted', label, trailing,
}: {
  icon: React.ElementType; iconTone?: string; label: string; trailing?: React.ReactNode;
}) {
  return (
    <div className="w-full flex items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[iconTone] ?? toneClasses.muted}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

function TileButton({
  to, icon: Icon, tone, label, hint,
}: {
  to: string; icon: React.ElementType; tone: keyof typeof toneClasses; label: string; hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col items-start p-4 bg-card border border-border rounded-xl shadow-sm hover:shadow-md hover:border-primary/30 transition-all press-scale"
    >
      <div className={`p-2 rounded-lg mb-3 ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="font-heading font-semibold text-foreground text-sm">{label}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">{hint}</span>
    </Link>
  );
}

function RowAction({
  onClick, icon: Icon, iconTone = 'muted', label, trailing,
}: {
  onClick: () => void; icon: React.ElementType; iconTone?: string; label: string; trailing?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-muted/40 transition-colors text-left">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[iconTone] ?? toneClasses.muted}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>
      <div className="shrink-0 flex items-center gap-2">{trailing}</div>
    </button>
  );
}

function TileAction({
  onClick, icon: Icon, tone, label, hint,
}: {
  onClick: () => void; icon: React.ElementType; tone: keyof typeof toneClasses; label: string; hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start p-4 bg-card border border-border rounded-xl shadow-sm hover:shadow-md hover:border-primary/30 transition-all press-scale text-left"
    >
      <div className={`p-2 rounded-lg mb-3 ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="font-heading font-semibold text-foreground text-sm">{label}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">{hint}</span>
    </button>
  );
}
