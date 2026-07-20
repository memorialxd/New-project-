import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

/**
 * Global online/offline indicator. Renders nothing while online.
 * When the device goes offline, shows a sticky bar at the top so the user
 * understands why orders/messages may not sync. Briefly confirms reconnection.
 */
export default function ConnectionStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setShowRestored(true);
      window.setTimeout(() => setShowRestored(false), 2500);
    };
    const goOffline = () => {
      setOnline(false);
      setShowRestored(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online && !showRestored) return null;

  return (
    <div
      className={`fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-heading font-bold shadow-md transition-colors ${
        online
          ? 'bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]'
          : 'bg-destructive text-destructive-foreground animate-pulse'
      }`}
      role="status"
      aria-live="polite"
    >
      {online ? (
        <>
          <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Σύνδεση αποκαταστάθηκε</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Χωρίς σύνδεση — οι ενέργειες θα συγχρονιστούν όταν επανέλθετε online</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-2 underline underline-offset-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-sm px-1"
            aria-label="Δοκίμασε ξανά τη σύνδεση"
          >
            Επανάληψη
          </button>
        </>
      )}
    </div>
  );
}
