import { useEffect, useState } from 'react';
import { Layers, Timer, MapPin, Store, Banknote, CreditCard, Plus, X, Check, EyeOff } from 'lucide-react';
import { shortenAddress } from '@/lib/address-utils';
import { stopOfferAlert } from '@/lib/driver-sound-prefs';

interface StackedOffer {
  id: string;
  storeName: string;
  storeAddress: string;
  deliveryAddress: string;
  estimatedPayout: number;
  basePay?: number;
  tipAmount?: number;
  poolBonus?: number;
  totalDistance: number;
  estimatedTime: number;
  itemCount: number;
  paymentMethod?: string | null;
  cashToCollect?: number | null;
}

interface Props {
  offer: StackedOffer;
  /** Position in the stacked queue (2 = second order, 3 = third). */
  index: number;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  /** Optional: silently dismiss without penalty (defaults to onDecline). */
  onRemove?: (id: string) => void;
  expiresAt?: string | null;
  timeoutSec?: number;
}

function secsLeft(expiresAt?: string | null, fallback = 60) {
  if (!expiresAt) return fallback;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function StackedOfferCard({
  offer, index, onAccept, onDecline, onRemove, expiresAt, timeoutSec = 60,
}: Props) {
  const totalWindow = expiresAt
    ? Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)) || timeoutSec
    : timeoutSec;
  const [left, setLeft] = useState(() => secsLeft(expiresAt, timeoutSec));

  useEffect(() => () => { stopOfferAlert(); }, []);

  useEffect(() => {
    if (left <= 0) { onDecline(offer.id); return; }
    const t = setTimeout(() => setLeft(secsLeft(expiresAt, left - 1)), 1000);
    return () => clearTimeout(t);
  }, [left, offer.id, onDecline, expiresAt]);

  const progress = Math.max(0, Math.min(100, (left / totalWindow) * 100));
  const urgent = left <= 15;
  const isCash = offer.paymentMethod === 'cash';
  const isCard = ['card', 'wallet', 'paid'].includes(offer.paymentMethod ?? '');
  const payout = ((offer.basePay ?? 0) + (offer.tipAmount ?? 0) + (offer.poolBonus ?? 0)) || offer.estimatedPayout;
  const ordinal = index === 2 ? '2η' : index === 3 ? '3η' : `${index}η`;

  const handleRemove = () => {
    stopOfferAlert();
    (onRemove ?? onDecline)(offer.id);
  };

  return (
    <div className="driver-card overflow-hidden relative border-2 border-[hsl(var(--driver-accent))]/40 shadow-[0_10px_30px_-12px_hsl(var(--driver-accent)/0.35)]">
      {/* Stack ribbon */}
      <div className="px-4 pt-3 pb-2.5 flex items-center gap-2 bg-gradient-to-r from-[hsl(var(--driver-accent))]/12 via-[hsl(var(--driver-accent))]/6 to-transparent border-b border-[hsl(var(--driver-border))]">
        <div className="h-7 w-7 rounded-lg gradient-primary flex items-center justify-center shrink-0">
          <Layers className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-heading font-extrabold uppercase tracking-[0.12em] text-[hsl(var(--driver-accent))] leading-none">
            {ordinal} παραγγελία · stack
          </p>
          <p className="text-[11px] text-[hsl(var(--driver-text-muted))] leading-tight mt-0.5 truncate">
            Προστίθεται στη διαδρομή σου
          </p>
        </div>
        <div className={`flex items-center gap-1 rounded-full px-2 h-7 border text-[12px] font-mono font-bold tabular-nums ${
          urgent
            ? 'bg-destructive/10 border-destructive/25 text-destructive'
            : 'bg-[hsl(var(--driver-surface-muted))] border-[hsl(var(--driver-border))] text-[hsl(var(--driver-text))]'
        }`}>
          <Timer className={`h-3 w-3 ${urgent ? 'animate-pulse' : ''}`} />
          0:{String(left).padStart(2, '0')}
        </div>
      </div>

      {/* Hairline timer */}
      <div className="h-[3px] bg-[hsl(var(--driver-surface-muted))]">
        <div
          className={`h-full transition-all duration-1000 ease-linear ${urgent ? 'bg-destructive' : 'bg-[hsl(var(--driver-accent))]'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Payout + route compact */}
      <div className="px-4 pt-3 pb-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-heading font-semibold uppercase tracking-wider text-[hsl(var(--driver-text-muted))]">
              Έξτρα αμοιβή
            </p>
            <p className="font-heading font-extrabold text-[28px] leading-none tabular-nums text-[hsl(var(--driver-accent))] mt-1 flex items-center">
              <Plus className="h-5 w-5 mr-0.5" strokeWidth={3} />
              {payout.toFixed(2)}
              <span className="text-[16px] text-[hsl(var(--driver-text-muted))] ml-0.5">€</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-[11px] text-[hsl(var(--driver-text-muted))]">
            <span className="tabular-nums">+{offer.totalDistance || '—'} χλμ</span>
            <span className="tabular-nums">~{offer.estimatedTime} λεπ</span>
            <span>{offer.itemCount} τεμ.</span>
          </div>
        </div>

        {(isCash || isCard) && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[10.5px] font-heading font-bold border"
            style={isCash
              ? { background: 'hsl(var(--driver-warm) / 0.12)', borderColor: 'hsl(var(--driver-warm) / 0.35)', color: 'hsl(var(--driver-warm))' }
              : { background: 'hsl(var(--driver-accent) / 0.12)', borderColor: 'hsl(var(--driver-accent) / 0.35)', color: 'hsl(var(--driver-accent))' }}>
            {isCash
              ? <><Banknote className="h-3 w-3" /> ΜΕΤΡΗΤΑ {offer.cashToCollect ? `· ${offer.cashToCollect.toFixed(2)}€` : ''}</>
              : <><CreditCard className="h-3 w-3" /> ΠΛΗΡΩΜΕΝΟ</>}
          </div>
        )}

        {/* Route mini */}
        <div className="mt-3 rounded-xl bg-[hsl(var(--driver-surface-muted))] border border-[hsl(var(--driver-border))] p-2.5 space-y-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Store className="h-3.5 w-3.5 text-[hsl(var(--driver-warm))] shrink-0" />
            <span className="text-[12px] font-heading font-bold text-[hsl(var(--driver-text))] truncate">{offer.storeName}</span>
            <span className="text-[11px] text-[hsl(var(--driver-text-muted))] truncate">· {shortenAddress(offer.storeAddress)}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-3.5 w-3.5 text-[hsl(var(--driver-accent))] shrink-0" />
            <span className="text-[12px] text-[hsl(var(--driver-text))] truncate">{shortenAddress(offer.deliveryAddress)}</span>
          </div>
        </div>

        {/* Actions: Accept (primary), Decline */}
        <div className="flex items-stretch gap-2 mt-4">
          <button
            onClick={() => { stopOfferAlert(); onAccept(offer.id); }}
            className="flex-[2] h-12 rounded-full text-[14px] font-heading font-extrabold bg-[hsl(var(--driver-accent))] text-white driver-glow-green hover:brightness-105 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
          >
            <Check className="h-4 w-4" strokeWidth={3} />
            Πρόσθεσε στη διαδρομή
          </button>
          <button
            onClick={() => { stopOfferAlert(); onDecline(offer.id); }}
            aria-label="Απόρριψη"
            title="Απόρριψη"
            className="w-12 h-12 rounded-full border border-[hsl(var(--driver-border-strong))] bg-[hsl(var(--driver-surface))] text-[hsl(var(--driver-text-muted))] hover:bg-[hsl(var(--driver-surface-muted))] active:scale-[0.95] transition-all flex items-center justify-center"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2.5} />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[9.5px] text-center text-[hsl(var(--driver-text-muted))] font-heading uppercase tracking-wider">
          <span>Αποδοχή</span>
          <span>Απόρριψη</span>
        </div>
      </div>
    </div>
  );
}
