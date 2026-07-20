import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Calendar as CalIcon, Plus, X, Save, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Δευτέρα' },
  { key: 'tue', label: 'Τρίτη' },
  { key: 'wed', label: 'Τετάρτη' },
  { key: 'thu', label: 'Πέμπτη' },
  { key: 'fri', label: 'Παρασκευή' },
  { key: 'sat', label: 'Σάββατο' },
  { key: 'sun', label: 'Κυριακή' },
];

type DaySchedule = { open: string; close: string; enabled: boolean };

export function StoreHoursManager({ storeId }: { storeId: string }) {
  const [hours, setHours] = useState<Record<string, DaySchedule>>({});
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('stores')
      .select('opening_hours, holiday_dates' as any)
      .eq('id', storeId)
      .maybeSingle()
      .then(({ data }) => {
        const d: any = data ?? {};
        setHours(d.opening_hours ?? {});
        setHolidays((d.holiday_dates ?? []) as string[]);
        setLoading(false);
      });
  }, [storeId]);

  const updateDay = (day: string, patch: Partial<DaySchedule>) => {
    setHours((p) => ({
      ...p,
      [day]: { ...(p[day] ?? { open: '09:00', close: '22:00', enabled: true }), ...patch },
    }));
  };

  const addHoliday = () => {
    if (!newHoliday) return;
    if (holidays.includes(newHoliday)) {
      toast.error('Η ημερομηνία υπάρχει ήδη');
      return;
    }
    setHolidays((p) => [...p, newHoliday].sort());
    setNewHoliday('');
  };

  const removeHoliday = (date: string) => {
    setHolidays((p) => p.filter((d) => d !== date));
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('stores')
      .update({ opening_hours: hours, holiday_dates: holidays } as any)
      .eq('id', storeId);
    setSaving(false);
    if (error) toast.error('Αποτυχία αποθήκευσης');
    else toast.success('Ώρες λειτουργίας αποθηκεύτηκαν');
  };

  if (loading) return <div className="text-center py-8 text-muted-foreground font-heading">Φόρτωση...</div>;

  return (
    <div className="space-y-4">
      <Card className="shadow-[var(--shadow-md)]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-5 w-5 text-primary" />
            <h3 className="font-heading font-bold text-foreground">Εβδομαδιαίο Ωράριο</h3>
          </div>
          {DAYS.map((d) => {
            const sched = hours[d.key] ?? { open: '09:00', close: '22:00', enabled: true };
            return (
              <div key={d.key} className="flex items-center gap-2 pb-2 border-b border-border last:border-0">
                <div className="w-24">
                  <p className="text-sm font-heading text-foreground">{d.label}</p>
                </div>
                <Switch
                  checked={sched.enabled}
                  onCheckedChange={(c) => updateDay(d.key, { enabled: c })}
                />
                {sched.enabled ? (
                  <div className="flex items-center gap-1.5 flex-1 justify-end">
                    <Input
                      type="time"
                      value={sched.open}
                      onChange={(e) => updateDay(d.key, { open: e.target.value })}
                      className="h-8 text-xs w-[105px]"
                    />
                    <span className="text-xs text-muted-foreground">—</span>
                    <Input
                      type="time"
                      value={sched.close}
                      onChange={(e) => updateDay(d.key, { close: e.target.value })}
                      className="h-8 text-xs w-[105px]"
                    />
                  </div>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground italic">Κλειστά</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-md)]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalIcon className="h-5 w-5 text-primary" />
            <h3 className="font-heading font-bold text-foreground">Αργίες & Κλειστές Ημέρες</h3>
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
              className="h-9"
            />
            <Button onClick={addHoliday} size="sm" disabled={!newHoliday}>
              <Plus className="h-4 w-4 mr-1" />
              Προσθήκη
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {holidays.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Καμία αργία προγραμματισμένη</p>
            ) : (
              holidays.map((date) => (
                <Badge key={date} variant="outline" className="gap-1.5 py-1 pl-2.5 pr-1">
                  {format(new Date(date), 'dd/MM/yyyy')}
                  <button
                    onClick={() => removeHoliday(date)}
                    className="rounded-full hover:bg-muted h-4 w-4 flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={save}
        disabled={saving}
        className="w-full h-12 gradient-primary text-primary-foreground font-heading shadow-primary"
      >
        <Save className="h-4 w-4 mr-2" />
        {saving ? 'Αποθήκευση...' : 'Αποθήκευση Ωραρίου'}
      </Button>
    </div>
  );
}
