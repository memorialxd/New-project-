import { useMemo } from 'react';
import {
  ArrowUp, ArrowUpRight, ArrowUpLeft, ArrowRight, ArrowLeft,
  CornerUpRight, CornerUpLeft, RotateCcw, Flag, Merge, Split,
  Disc as RoundaboutIcon,
} from 'lucide-react';
import type { RouteStep } from './DriverMapbox';

interface TurnByTurnBannerProps {
  /** Distance in meters until the upcoming maneuver (computed live). */
  distanceToNext: number;
  /** The upcoming maneuver step. */
  step: RouteStep;
  /** Optional name of the road *after* the maneuver, shown in the secondary strip. */
  nextStreet?: string | null;
}

function formatMeters(m: number): string {
  if (m < 100) return `${Math.round(m / 10) * 10} μ`;
  if (m < 1000) return `${Math.round(m / 50) * 50} μ`;
  return `${(m / 1000).toFixed(1)} χλμ`;
}

function ManeuverIcon({ step }: { step: RouteStep }) {
  const t = step.maneuverType;
  const m = step.modifier;

  // Roundabout / rotary
  if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') {
    return <RoundaboutIcon className="h-7 w-7" strokeWidth={2.5} />;
  }
  if (t === 'arrive') return <Flag className="h-7 w-7" strokeWidth={2.5} />;
  if (t === 'merge') return <Merge className="h-7 w-7" strokeWidth={2.5} />;
  if (t === 'fork') return <Split className="h-7 w-7" strokeWidth={2.5} />;

  switch (m) {
    case 'left':
    case 'sharp left':
      return <CornerUpLeft className="h-7 w-7" strokeWidth={2.5} />;
    case 'right':
    case 'sharp right':
      return <CornerUpRight className="h-7 w-7" strokeWidth={2.5} />;
    case 'slight left':
      return <ArrowUpLeft className="h-7 w-7" strokeWidth={2.5} />;
    case 'slight right':
      return <ArrowUpRight className="h-7 w-7" strokeWidth={2.5} />;
    case 'uturn':
      return <RotateCcw className="h-7 w-7" strokeWidth={2.5} />;
    case 'straight':
      return <ArrowUp className="h-7 w-7" strokeWidth={2.5} />;
    default:
      return <ArrowUp className="h-7 w-7" strokeWidth={2.5} />;
  }
}

export function TurnByTurnBanner({ distanceToNext, step, nextStreet }: TurnByTurnBannerProps) {
  const distanceLabel = useMemo(() => formatMeters(Math.max(0, distanceToNext)), [distanceToNext]);

  return (
    <div className="rounded-2xl overflow-hidden shadow-2xl bg-[hsl(0,0%,12%)] text-white border border-white/5">
      {/* Primary instruction row */}
      <div className="flex items-stretch gap-3 px-4 py-3">
        <div className="flex flex-col items-center justify-center min-w-[70px]">
          <ManeuverIcon step={step} />
          <span className="mt-1 text-sm font-heading font-bold tabular-nums">{distanceLabel}</span>
        </div>
        <div className="flex-1 min-w-0 flex items-center">
          <p className="font-heading font-bold text-[17px] leading-snug line-clamp-2">
            {step.instruction || 'Συνεχίστε ευθεία'}
          </p>
        </div>
      </div>

      {/* Secondary "next street" strip */}
      {nextStreet && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.07] border-t border-white/10">
          <ArrowUp className="h-4 w-4 opacity-90" strokeWidth={2.5} />
          <p className="text-sm text-white/85 truncate">{nextStreet}</p>
        </div>
      )}
    </div>
  );
}
