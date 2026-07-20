import { useState } from 'react';
import { Clock, CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  value: string | null; // ISO string or null = ASAP
  onChange: (iso: string | null) => void;
}

function buildSlots(): { label: string; iso: string }[] {
  const out: { label: string; iso: string }[] = [];
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60_000);
  // Round to next 15 min
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 8; i++) {
    const d = new Date(start.getTime() + i * 30 * 60_000);
    const isToday = d.getDate() === now.getDate();
    out.push({
      label: `${isToday ? 'Σήμερα' : 'Αύριο'} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      iso: d.toISOString(),
    });
  }
  return out;
}

export default function ScheduledDeliveryPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const slots = buildSlots();

  return (
    <Card className="shadow-[var(--shadow-md)]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="font-heading font-semibold text-foreground">Χρόνος Παράδοσης</h2>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChange(null)}
            className={`py-2.5 rounded-xl text-sm font-heading font-semibold transition-all ${
              !value ? 'gradient-primary text-primary-foreground shadow-primary' : 'bg-muted text-foreground'
            }`}
          >
            <Clock className="h-4 w-4 inline mr-1" /> Άμεσα
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className={`py-2.5 rounded-xl text-sm font-heading font-semibold transition-all ${
              value ? 'gradient-primary text-primary-foreground shadow-primary' : 'bg-muted text-foreground'
            }`}
          >
            <CalendarClock className="h-4 w-4 inline mr-1" />
            {value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Προγραμματισμός'}
          </button>
        </div>

        {(open || value) && (
          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t">
            {slots.map(s => (
              <Button
                key={s.iso}
                size="sm"
                variant={value === s.iso ? 'default' : 'outline'}
                onClick={() => { onChange(s.iso); setOpen(false); }}
                className="text-xs"
              >
                {s.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
