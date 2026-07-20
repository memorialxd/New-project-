import { useEffect, useState } from 'react';
import {
  LogOut, User, Home, UserCircle, Bell, Settings, TrendingUp, Wallet,
  LifeBuoy, Users, Share2, FileText, HelpCircle, Star, Coffee, Pause, PackageX,
  Shield, Bike, ShoppingCart, Repeat, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { DriverAppSettings } from '@/components/driver/DriverAppSettings';
import { useDriverState } from '@/hooks/useDriverState';
import { toast } from 'sonner';

export function UserMenu() {
  const { user, profile, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const isDriver = profile?.role === 'driver';
  
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [activeOrder, setActiveOrder] = useState<{ id: string; status: string } | null>(null);
  const { state: driverState, startBreak, endBreak } = useDriverState();
  const onBreak = !!driverState?.on_break;

  // Track driver's active (releasable) order so we can offer "Unassign" under Break.
  // Releasable = assigned to me and not yet picked up / delivered / canceled.
  useEffect(() => {
    if (!isDriver || !user) { setActiveOrder(null); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await (supabase as any)
        .from('orders')
        .select('id, status')
        .eq('driver_id', user.id)
        .not('status', 'in', '(picked_up,delivered,cancelled)')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setActiveOrder(data ?? null);
    };
    load();
    const ch = supabase
      .channel(`user-menu-active-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `driver_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isDriver, user]);

  const handleReleaseOrder = async () => {
    if (!activeOrder) return;
    setReleasing(true);
    const { error } = await (supabase as any).rpc('driver_release_order', { p_order_id: activeOrder.id });
    setReleasing(false);
    if (error) { toast.error(error.message || 'Αποτυχία απόθεσης παραγγελίας'); return; }
    toast.success('Η παραγγελία επανεκχωρείται σε άλλον οδηγό');
    setReleaseOpen(false);
    setActiveOrder(null);
  };

  // Live tick so the countdown updates while menu is open
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!onBreak) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [onBreak]);

  // Auto-end break when timer expires
  useEffect(() => {
    if (onBreak && driverState?.break_until && new Date(driverState.break_until) <= new Date()) {
      endBreak();
    }
  });

  const breakRemaining = driverState?.break_until
    ? Math.max(0, Math.floor((new Date(driverState.break_until).getTime() - Date.now()) / 1000))
    : 0;
  const mm = Math.floor(breakRemaining / 60).toString().padStart(2, '0');
  const ss = (breakRemaining % 60).toString().padStart(2, '0');

  const itemClassName =
    'min-h-11 rounded-xl px-3 py-3 text-sm font-medium text-foreground cursor-pointer transition-colors focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
  const labelClassName =
    'px-3 pt-2 pb-1 text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground';

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const go = (path: string) => {
    setMenuOpen(false);
    setTimeout(() => navigate(path), 0);
  };

  const handleShare = async () => {
    const text = 'Γίνε Fresh Delivery driver και κέρδισε bonus καλωσορίσματος!';
    const url = window.location.origin + '/auth';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Fresh Delivery Drivers', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success('Αντιγράφηκε ο σύνδεσμος');
      }
    } catch {}
  };

  if (!user) return null;

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-10 w-10 rounded-full text-white border-0 shadow-lg hover:brightness-110 hover:scale-105 transition-all ${
              isDriver ? 'driver-gradient-earn' : 'gradient-primary shadow-primary'
            }`}
          >
            <User className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[200] w-72 max-w-[calc(100vw-2rem)] max-h-[75vh] overflow-y-auto rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
        >
          {/* Identity card */}
          <div className="mb-1 rounded-xl border border-border bg-muted/60 px-3 py-3 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0 ${isDriver ? 'driver-gradient-earn' : 'gradient-primary'}`}>
              <span className="font-heading font-bold text-sm">
                {(profile?.full_name || user.email || '?').slice(0, 1).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-heading font-bold text-foreground truncate">
                {profile?.full_name || 'Χρήστης'}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {profile?.public_code && (
                  <span
                    className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] font-mono font-semibold text-foreground/80 cursor-pointer"
                    onClick={() => { navigator.clipboard?.writeText(profile.public_code!); toast.success('Κωδικός αντιγράφηκε'); }}
                    title="Κλικ για αντιγραφή"
                  >
                    {profile.public_code}
                  </span>
                )}
                {isDriver && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--driver-accent))]/15 px-2 py-0.5 text-[9.5px] font-heading font-bold text-[hsl(var(--driver-accent))] uppercase tracking-wider">
                    <Star className="h-2.5 w-2.5" /> Driver
                  </span>
                )}
              </div>
            </div>
          </div>

          {isDriver ? (
            <>
              {/* SHIFT */}
              <DropdownMenuLabel className={labelClassName}>Βάρδια</DropdownMenuLabel>
              {onBreak ? (
                <DropdownMenuItem
                  className={`${itemClassName} bg-warning/10 text-warning focus:bg-warning/15 focus:text-warning data-[highlighted]:bg-warning/15 data-[highlighted]:text-warning`}
                  onSelect={(e) => { e.preventDefault(); endBreak(); setMenuOpen(false); }}
                >
                  <Pause className="mr-2 h-4 w-4 shrink-0" />
                  <span className="flex-1">Λήξη Διαλείμματος</span>
                  <span className="font-heading text-xs font-bold tabular-nums">{mm}:{ss}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className={itemClassName}
                  onSelect={(e) => { e.preventDefault(); setMenuOpen(false); setTimeout(() => setBreakOpen(true), 50); }}
                >
                  <Coffee className="mr-2 h-4 w-4 shrink-0" />
                  Διάλειμμα
                </DropdownMenuItem>
              )}
              {activeOrder && (
                <DropdownMenuItem
                  className={`${itemClassName} text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive`}
                  onSelect={(e) => { e.preventDefault(); setMenuOpen(false); setTimeout(() => setReleaseOpen(true), 50); }}
                >
                  <PackageX className="mr-2 h-4 w-4 shrink-0" />
                  Απόθεση Παραγγελίας
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="my-1" />

              {/* EARNINGS */}
              <DropdownMenuLabel className={labelClassName}>Έσοδα</DropdownMenuLabel>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/driver?tab=earnings')}>
                <TrendingUp className="mr-2 h-4 w-4 shrink-0 text-[hsl(var(--driver-accent))]" />
                Κέρδη & Στατιστικά
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/driver?tab=wallet')}>
                <Wallet className="mr-2 h-4 w-4 shrink-0 text-[hsl(var(--driver-accent))]" />
                Πορτοφόλι
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              {/* ACCOUNT */}
              <DropdownMenuLabel className={labelClassName}>Λογαριασμός</DropdownMenuLabel>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/driver/profile')}>
                <UserCircle className="mr-2 h-4 w-4 shrink-0" />
                Προφίλ & Έγγραφα
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/driver?tab=referral')}>
                <Users className="mr-2 h-4 w-4 shrink-0" />
                Πρόσκληση Οδηγών
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              {/* SETTINGS */}
              <DropdownMenuLabel className={labelClassName}>Ρυθμίσεις</DropdownMenuLabel>
              <DropdownMenuItem
                className={itemClassName}
                onSelect={(e) => { e.preventDefault(); setMenuOpen(false); setTimeout(() => setSettingsOpen(true), 50); }}
              >
                <Settings className="mr-2 h-4 w-4 shrink-0" />
                Ρυθμίσεις Εφαρμογής
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              {/* HELP */}
              <DropdownMenuLabel className={labelClassName}>Βοήθεια</DropdownMenuLabel>
              <DropdownMenuItem className={itemClassName} onSelect={() => { setMenuOpen(false); handleShare(); }}>
                <Share2 className="mr-2 h-4 w-4 shrink-0" />
                Μοιραστείτε την εφαρμογή
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              {/* LEGAL */}
              <DropdownMenuLabel className={labelClassName}>Νομικά Έγγραφα</DropdownMenuLabel>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/legal/terms')}>
                <FileText className="mr-2 h-4 w-4 shrink-1" />
                Όροι Χρήσης
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/legal/privacy')}>
                <Shield className="mr-2 h-4 w-4 shrink-1" />
                Απορρήτου
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/legal/refunds')}>
                <RefreshCw className="mr-2 h-4 w-4 shrink-1" />
                Επιστροφών
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/profile')}>
                <UserCircle className="mr-2 h-4 w-4 shrink-0" />
                Το Προφίλ μου
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/')}>
                <Home className="mr-2 h-4 w-4 shrink-0" />
                Αρχική
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              {/* LEGAL (non-driver) */}
              <DropdownMenuLabel className={labelClassName}>Νομικά Έγγραφα</DropdownMenuLabel>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/legal/terms')}>
                <FileText className="mr-2 h-4 w-4 shrink-0" />
                Όροι Χρήσης
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/legal/privacy')}>
                <Shield className="mr-2 h-4 w-4 shrink-0" />
                Απορρήτου
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/legal/refunds')}>
                <RefreshCw className="mr-2 h-4 w-4 shrink-0" />
                Επιστροφών
              </DropdownMenuItem>
            </>
          )}

          {isAdmin && (
            <>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuLabel className={labelClassName}>
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-3 w-3" /> Εναλλαγή Προβολής (Admin)
                </span>
              </DropdownMenuLabel>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/admin')}>
                <Shield className="mr-2 h-4 w-4 shrink-0" />
                Admin Πίνακας
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/driver')}>
                <Bike className="mr-2 h-4 w-4 shrink-0" />
                Προβολή Οδηγού
              </DropdownMenuItem>
              <DropdownMenuItem className={itemClassName} onSelect={() => go('/')}>
                <ShoppingCart className="mr-2 h-4 w-4 shrink-0" />
                Προβολή Πελάτη
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            onSelect={() => { setMenuOpen(false); handleSignOut(); }}
            className="min-h-11 rounded-xl px-3 py-3 text-sm font-medium text-destructive cursor-pointer transition-colors focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4 shrink-0" />
            Αποσύνδεση
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isDriver && (
        <>
          {/* Sound settings merged into DriverAppSettings */}
          <DriverAppSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
          <Dialog open={breakOpen} onOpenChange={setBreakOpen}>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>Επιλέξτε διάρκεια διαλείμματος</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                {[15, 30, 45, 60].map(m => (
                  <Button key={m} onClick={() => { startBreak(m); setBreakOpen(false); }} variant="outline" className="h-12">
                    {m} λεπτά
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Δεν θα λαμβάνεις νέες παραγγελίες κατά τη διάρκεια του διαλείμματος.
              </p>
            </DialogContent>
          </Dialog>

          <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>Απόθεση Παραγγελίας;</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Η παραγγελία θα επιστραφεί στο σύστημα και θα ανατεθεί άμεσα σε άλλον διαθέσιμο οδηγό.
                Συχνές αποθέσεις μπορεί να επηρεάσουν το ποσοστό αποδοχής σου.
              </p>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setReleaseOpen(false)} disabled={releasing}>
                  Άκυρο
                </Button>
                <Button variant="destructive" className="flex-1" onClick={handleReleaseOrder} disabled={releasing}>
                  {releasing ? 'Απόθεση…' : 'Απόθεση'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
