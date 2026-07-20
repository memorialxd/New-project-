import { Sparkles, Trophy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useRewards, tierEmoji } from '@/hooks/useRewards';

export function RewardsCard() {
  const { rewards, tierInfo, loading } = useRewards();
  if (loading || !rewards) return null;

  const progressPct = tierInfo.nextAt
    ? Math.min(100, (rewards.lifetime_points / tierInfo.nextAt) * 100)
    : 100;
  const remaining = tierInfo.nextAt ? Math.max(0, tierInfo.nextAt - rewards.lifetime_points) : 0;

  return (
    <Card className="overflow-hidden border-primary/20 shadow-[var(--shadow-md)]">
      <CardContent className="p-0">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-card shadow-sm flex items-center justify-center text-2xl">
                {tierEmoji(rewards.tier)}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                  Επίπεδο {tierInfo.label}
                </p>
                <p className="font-heading font-bold text-2xl text-foreground leading-tight tabular-nums">
                  {rewards.points} <span className="text-sm font-normal text-muted-foreground">πόντοι</span>
                </p>
              </div>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
          </div>

          {tierInfo.nextAt && (
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Πρόοδος</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {rewards.lifetime_points}/{tierInfo.nextAt}
                </span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Trophy className="h-3 w-3" />
                Ακόμα <span className="font-bold text-foreground">{remaining}</span> πόντοι για το επόμενο επίπεδο
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
