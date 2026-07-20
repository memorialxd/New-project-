import { useEffect, useState } from 'react';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { Megaphone, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { format, formatDistanceToNowStrict, isPast } from 'date-fns';

interface Props {
  audience: 'drivers' | 'store_owners' | 'support';
}

export default function AnnouncementsBanner({ audience }: Props) {
  const { data: announcements } = useAnnouncements(audience);
  const [, setTick] = useState(0);

  // Re-render every 30s so countdowns stay fresh and expired ones drop off
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = (announcements ?? []).filter(
    (a: any) => !a.expires_at || !isPast(new Date(a.expires_at))
  );

  if (!visible.length) return null;

  return (
    <div className="space-y-2">
      {visible.slice(0, 3).map((a: any) => {
        const expiresAt = a.expires_at ? new Date(a.expires_at) : null;
        return (
          <div
            key={a.id}
            className="rounded-xl border border-amber-400/60 bg-gradient-to-br from-amber-50 to-amber-100/80 dark:from-amber-950/40 dark:to-amber-900/30 dark:border-amber-500/40 shadow-sm"
          >
            <div className="p-3 flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
                <Megaphone className="h-4 w-4" strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-heading font-bold text-sm text-amber-950 dark:text-amber-50">
                    {a.title}
                  </p>
                  {expiresAt ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-900 bg-amber-200 dark:bg-amber-500/30 dark:text-amber-100 rounded-full px-1.5 py-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {formatDistanceToNowStrict(expiresAt, { addSuffix: false })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-900 bg-emerald-200 dark:bg-emerald-500/30 dark:text-emerald-100 rounded-full px-1.5 py-0.5">
                      <InfinityIcon className="h-2.5 w-2.5" /> Μόνιμο
                    </span>
                  )}
                </div>
                <p className="text-xs text-amber-900/90 dark:text-amber-100/90 mt-1 leading-relaxed">
                  {a.message}
                </p>
                <p className="text-[10px] text-amber-800/70 dark:text-amber-200/60 mt-1.5">
                  {format(new Date(a.created_at), 'MMM d, HH:mm')}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
