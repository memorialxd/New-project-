import { useEffect, useMemo, useState } from 'react';
import { Target, Edit2, Check, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useStoreAnalytics } from '@/hooks/useStoreAnalytics';

interface StoreDailyGoalCardProps {
  storeId: string;
}

const STORAGE_KEY_PREFIX = 'store-daily-goal-';

export function StoreDailyGoalCard({ storeId }: StoreDailyGoalCardProps) {
  const { todayRevenue, todayOrders, loading } = useStoreAnalytics(storeId);
  const [goal, setGoal] = useState<number>(500);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('500');

  // Load goal from localStorage on mount/store change
  useEffect(() => {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${storeId}`);
    const value = stored ? Number(stored) : 500;
    setGoal(value);
    setDraft(String(value));
  }, [storeId]);

  const save = () => {
    const v = Math.max(0, Number(draft) || 0);
    setGoal(v);
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${storeId}`, String(v));
    setEditing(false);
  };

  // Hourly pace projection — assumes 12h operating window
  const projection = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const elapsedHours = Math.max(0.25, (now.getTime() - startOfDay.getTime()) / 3_600_000);
    const hourlyRate = todayRevenue / elapsedHours;
    const projectedDay = hourlyRate * 12;
    return { hourlyRate, projectedDay };
  }, [todayRevenue]);

  const pct = goal > 0 ? Math.min(100, (todayRevenue / goal) * 100) : 0;
  const onTrack = goal > 0 && projection.projectedDay >= goal;

  if (loading) return null;

  return (
    <Card className="shadow-[var(--shadow-md)]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <h3 className="font-heading font-bold text-foreground text-sm">Στόχος Ημέρας</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={() => editing ? save() : setEditing(true)}>
            {editing ? <Check className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between items-baseline text-sm">
            <span className="text-muted-foreground">Έσοδα σήμερα</span>
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="font-heading font-semibold text-foreground tabular-nums">€{todayRevenue.toFixed(2)} /</span>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  className="h-7 w-20 text-xs"
                  type="number"
                />
              </div>
            ) : (
              <span className="font-heading font-semibold text-foreground tabular-nums">
                €{todayRevenue.toFixed(2)} / €{goal}
              </span>
            )}
          </div>
          <Progress value={pct} className="h-2" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{todayOrders} {todayOrders === 1 ? 'παραγγελία' : 'παραγγελίες'}</span>
            <span className={`font-heading font-semibold ${pct >= 100 ? 'text-success' : 'text-muted-foreground'}`}>
              {pct.toFixed(0)}%
            </span>
          </div>
        </div>

        {todayRevenue > 0 && goal > 0 && (
          <div className="flex items-start gap-2 pt-2 border-t border-border">
            <TrendingUp className={`h-4 w-4 mt-0.5 flex-shrink-0 ${onTrack ? 'text-success' : 'text-warning'}`} />
            <p className="text-xs text-muted-foreground">
              {pct >= 100 ? (
                <span className="text-success font-heading font-semibold">🎉 Στόχος επιτεύχθηκε!</span>
              ) : onTrack ? (
                <span className="text-success">Με ρυθμό <strong>€{projection.hourlyRate.toFixed(2)}/ώρα</strong> — προβλέπεται <strong className="tabular-nums">€{projection.projectedDay.toFixed(0)}</strong> σήμερα</span>
              ) : (
                <span>Με ρυθμό <strong>€{projection.hourlyRate.toFixed(2)}/ώρα</strong> — χρειάζεστε <strong className="tabular-nums">€{(goal / 12).toFixed(2)}/ώρα</strong> για τον στόχο</span>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
