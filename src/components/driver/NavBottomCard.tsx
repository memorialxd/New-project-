import { Phone, X } from 'lucide-react';

interface NavBottomCardProps {
  title: string;
  subtitle?: string | null;
  /** Remaining time in seconds */
  durationSec: number;
  /** Remaining distance in meters */
  distanceMeters: number;
  phone?: string | null;
  onExit: () => void;
}

function formatDuration(seconds: number) {
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 60) return `${mins} λεπτά`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}ω ${m}λ`;
}

function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} μ`;
  return `${(m / 1000).toFixed(1)} χλμ`;
}

export function NavBottomCard({
  title, subtitle, durationSec, distanceMeters, phone, onExit,
}: NavBottomCardProps) {
  return (
    <div className="rounded-t-[28px] bg-[hsl(var(--driver-surface))] border-t border-[hsl(var(--driver-border))] shadow-[0_-12px_32px_-12px_hsl(220,18%,14%,0.18)] overflow-hidden">
      {/* drag affordance */}
      <div className="flex justify-center pt-2.5 pb-1">
        <div className="h-1.5 w-10 rounded-full bg-[hsl(var(--driver-text-muted))]/25" />
      </div>

      <div className="px-5 pt-2 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10.5px] font-heading font-semibold uppercase tracking-[0.08em] text-[hsl(var(--driver-text-muted))]">
              Πλοήγηση προς
            </p>
            <p className="font-heading font-extrabold text-[18px] text-[hsl(var(--driver-text))] leading-tight tracking-tight truncate mt-0.5">
              {title}
            </p>
            <p className="text-[13px] text-[hsl(var(--driver-text-muted))] mt-1 tabular-nums">
              {formatDuration(durationSec)} · {formatDistance(distanceMeters)}
            </p>
          </div>

          {phone && (
            <a
              href={`tel:${phone}`}
              className="h-12 w-12 rounded-full bg-[hsl(var(--driver-info))]/10 border border-[hsl(var(--driver-info))]/25 flex items-center justify-center hover:bg-[hsl(var(--driver-info))]/15 active:scale-95 transition-all"
              aria-label="Κλήση"
            >
              <Phone className="h-5 w-5 text-[hsl(var(--driver-info))]" strokeWidth={2.5} />
            </a>
          )}

          <button
            onClick={onExit}
            className="h-12 w-12 rounded-full bg-[hsl(var(--driver-surface-muted))] border border-[hsl(var(--driver-border))] text-[hsl(var(--driver-text))] flex items-center justify-center hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive active:scale-95 transition-all"
            aria-label="Έξοδος"
          >
            <X className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>

        {subtitle && (
          <p className="mt-3 text-[13px] text-[hsl(var(--driver-text))]/85 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
