import { useEffect, useState } from 'react';
import { Target, Edit2, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useDriverState } from '@/hooks/useDriverState';
import { useEarnings } from '@/hooks/useEarnings';

export default function DriverGoalsCard() {
  const { state, update } = useDriverState();
  const { today: todaySummary, week: weekSummary } = useEarnings();
  const [editing, setEditing] = useState(false);
  const [daily, setDaily] = useState('50');
  const [weekly, setWeekly] = useState('300');

  useEffect(() => {
    if (state) {
      setDaily(String(state.daily_goal));
      setWeekly(String(state.weekly_goal));
    }
  }, [state]);

  if (!state) return null;

  const todayTotal = todaySummary.total;
  const weekTotal = weekSummary.total;

  const dailyPct = Math.min(100, (todayTotal / state.daily_goal) * 100);
  const weeklyPct = Math.min(100, (weekTotal / state.weekly_goal) * 100);

  const save = async () => {
    await update({ daily_goal: Number(daily) || 50, weekly_goal: Number(weekly) || 300 });
    setEditing(false);
  };

  return (
    <Card className="shadow-[var(--shadow-md)]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <h3 className="font-heading font-bold text-foreground">Στόχοι Εσόδων</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={() => editing ? save() : setEditing(true)}>
            {editing ? <Check className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Σήμερα</span>
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="text-foreground">€{todayTotal.toFixed(2)} / </span>
                <Input value={daily} onChange={e => setDaily(e.target.value)} className="h-6 w-16 text-xs" />
              </div>
            ) : (
              <span className="font-heading font-semibold text-foreground">
                €{todayTotal.toFixed(2)} / €{state.daily_goal}
              </span>
            )}
          </div>
          <Progress value={dailyPct} className="h-2" />
          {dailyPct >= 100 && <p className="text-xs text-success font-heading">🎉 Στόχος επιτεύχθηκε!</p>}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Αυτή την εβδομάδα</span>
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="text-foreground">€{weekTotal.toFixed(2)} / </span>
                <Input value={weekly} onChange={e => setWeekly(e.target.value)} className="h-6 w-20 text-xs" />
              </div>
            ) : (
              <span className="font-heading font-semibold text-foreground">
                €{weekTotal.toFixed(2)} / €{state.weekly_goal}
              </span>
            )}
          </div>
          <Progress value={weeklyPct} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
}
