import { ChevronRight } from 'lucide-react';
import { OfferCard, type OfferItem } from './OfferCard';

interface OfferRowProps {
  title: string;
  /** Optional eyebrow chip rendered before the title (e.g. red "1+1") */
  eyebrow?: React.ReactNode;
  /** Optional subtitle under the title */
  subtitle?: string;
  items: OfferItem[];
  /** Optional click handler for "See all" link */
  onSeeAll?: () => void;
  seeAllLabel?: string;
  /** Tinted section background — used by "Free delivery" */
  tone?: 'plain' | 'pink' | 'cream';
  /** Optional decorative sticker rendered top-right of the section header */
  decoration?: React.ReactNode;
}

/**
 * Horizontally-scrolling row of OfferCards with a section header.
 * Mirrors the efood "1+1 προσφορές" / "Δωρεάν delivery" rows.
 */
export function OfferRow({
  title,
  eyebrow,
  subtitle,
  items,
  onSeeAll,
  seeAllLabel = 'Δες τα όλα',
  tone = 'plain',
  decoration,
}: OfferRowProps) {
  if (items.length === 0) return null;

  const sectionBg =
    tone === 'pink'
      ? 'bg-[hsl(12,75%,97%)]'
      : tone === 'cream'
        ? 'bg-[hsl(36,55%,96%)]'
        : '';

  return (
    <section className={`relative pt-6 pb-5 ${sectionBg}`}>
      <div className="px-5 flex items-end justify-between mb-3 relative">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {eyebrow}
            <h2 className="font-heading font-black text-[20px] text-[hsl(0,0%,9%)] leading-tight tracking-tight truncate">
              {title}
            </h2>
          </div>
          {subtitle && (
            <p className="text-[12px] c-muted mt-1 font-semibold">{subtitle}</p>
          )}
        </div>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="shrink-0 inline-flex items-center gap-0.5 text-[12px] font-extrabold c-accent active:scale-95 transition-transform"
          >
            {seeAllLabel}
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.6} />
          </button>
        )}
        {decoration && (
          <div className="absolute -top-2 right-3 pointer-events-none">{decoration}</div>
        )}
      </div>

      <div className="overflow-x-auto no-scrollbar">
        <div className="flex gap-3 px-5 pb-2 w-max">
          {items.map(item => (
            <OfferCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
