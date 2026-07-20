import { Link } from 'react-router-dom';
import { Sparkles, Gift, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRewards, tierEmoji } from '@/hooks/useRewards';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Καληνύχτα';
  if (h < 12) return 'Καλημέρα';
  if (h < 17) return 'Καλό μεσημέρι';
  if (h < 22) return 'Καλησπέρα';
  return 'Καλό βράδυ';
}

/**
 * Personalised home strip: greeting + loyalty progress + referral CTA.
 * Only renders for signed-in customers.
 */
export function HomeGreeting() {
  const { user, profile } = useAuth();
  const { rewards, tierInfo } = useRewards();

  if (!user) return null;

  const firstName = (profile?.full_name ?? '').split(' ')[0];
  const points = rewards?.points ?? 0;
  const nextAt = tierInfo.nextAt ?? 0;
  const pct = nextAt ? Math.min(100, Math.round((points / nextAt) * 100)) : 100;

  return (
    <section className="px-5 pt-5">
      <div className="rounded-3xl bg-white border border-[hsl(0,0%,93%)] shadow-[0_2px_4px_-2px_hsl(0_0%_0%/0.04),0_14px_30px_-18px_hsl(0_0%_0%/0.18)] overflow-hidden">
        <div className="p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] font-extrabold c-muted leading-none">
              {greeting()}
            </p>
            <h2 className="font-heading font-black text-[18px] text-[hsl(0,0%,9%)] truncate mt-1.5 leading-none">
              {firstName ? `${firstName} 👋` : 'Καλώς ήρθες 👋'}
            </h2>
          </div>
          <Link
            to="/profile"
            className="shrink-0 inline-flex items-center gap-2 c-bg-accent-soft c-accent rounded-full pl-3 pr-2 py-1.5 text-[12px] font-extrabold"
          >
            <span className="emoji text-sm leading-none">{tierEmoji(rewards?.tier ?? 'bronze')}</span>
            <span className="tabular-nums">{points} πόντοι</span>
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.6} />
          </Link>
        </div>

        {tierInfo.next && nextAt > 0 && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-[11px] font-bold c-muted mb-1.5">
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 c-accent" strokeWidth={2.6} />
                {nextAt - points} πόντοι για {tierInfo.next.toUpperCase()}
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[hsl(0,0%,94%)] overflow-hidden">
              <div className="h-full c-bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <Link
          to="/profile"
          className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[hsl(0,0%,95%)] active:bg-[hsl(0,0%,98%)]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-8 w-8 rounded-full c-bg-accent-soft c-accent flex items-center justify-center shrink-0">
              <Gift className="h-4 w-4" strokeWidth={2.6} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold text-[hsl(0,0%,9%)] leading-tight">Κάλεσε φίλους, κερδίστε και οι δύο 5€</p>
              <p className="text-[11px] c-muted leading-tight mt-0.5">Δες τον κωδικό σου στο προφίλ</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 c-muted shrink-0" strokeWidth={2.6} />
        </Link>
      </div>
    </section>
  );
}

export default HomeGreeting;
