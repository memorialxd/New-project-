import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Flame } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * Lightweight driver-side surge banner. Shows the highest active surge
 * multiplier so the driver sees when their pay is boosted.
 */
export default function SurgeStatusBadge() {
  const { data } = useQuery({
    queryKey: ['driver-active-surge'],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('surge_events')
        .select('multiplier, ends_at, reason, zone_id')
        .or('ends_at.is.null,ends_at.gt.' + new Date().toISOString())
        .order('multiplier', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as { multiplier: number; ends_at: string | null; reason: string | null } | null;
    },
  });

  if (!data || Number(data.multiplier) <= 1.0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-warning">
      <Flame className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold leading-tight">
          Surge ×{Number(data.multiplier).toFixed(2)} — αυξημένη πληρωμή παράδοσης
        </p>
        {data.ends_at && (
          <p className="text-[10.5px] opacity-80 leading-tight mt-0.5">
            έως {formatDistanceToNow(new Date(data.ends_at), { addSuffix: true })}
            {data.reason ? ` · ${data.reason}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
