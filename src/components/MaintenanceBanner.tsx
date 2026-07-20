import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle } from 'lucide-react';

export default function MaintenanceBanner() {
  const [data, setData] = useState<{ maintenance_mode: boolean; maintenance_message: string | null } | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await (supabase as any).rpc('get_platform_settings_public');
      const row = Array.isArray(data) ? data[0] : data;
      setData(row ? { maintenance_mode: !!row.maintenance_mode, maintenance_message: row.maintenance_message ?? null } : null);
    };
    load();
    const id = setInterval(load, 30_000);
    const ch = supabase.channel('maintenance')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'platform_settings' }, () => load())
      .subscribe();
    return () => { clearInterval(id); supabase.removeChannel(ch); };
  }, []);

  if (!data?.maintenance_mode) return null;

  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{data.maintenance_message || 'Η πλατφόρμα βρίσκεται σε συντήρηση. Επιστρέφουμε σύντομα.'}</span>
    </div>
  );
}
