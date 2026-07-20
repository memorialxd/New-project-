import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Activity, Filter } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format, formatDistanceToNow } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AuditEntry {
  id: string;
  actor_id: string;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  description: string | null;
  metadata: any;
  created_at: string;
}

const actionColors: Record<string, string> = {
  toggle_feature_flag: 'bg-blue-500/10 text-blue-600',
  enable_maintenance: 'bg-red-500/10 text-red-600',
  disable_maintenance: 'bg-emerald-500/10 text-emerald-600',
  user_action: 'bg-violet-500/10 text-violet-600',
  order_override: 'bg-orange-500/10 text-orange-600',
  surge_zone_create: 'bg-pink-500/10 text-pink-600',
  ban_user: 'bg-red-500/10 text-red-600',
  grant_permission: 'bg-cyan-500/10 text-cyan-600',
};

export default function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    setEntries((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = entries.filter(e => {
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (e.actor_name ?? '').toLowerCase().includes(s) ||
      e.action.toLowerCase().includes(s) ||
      (e.description ?? '').toLowerCase().includes(s) ||
      (e.target_id ?? '').toLowerCase().includes(s)
    );
  });

  const uniqueActions = Array.from(new Set(entries.map(e => e.action)));

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading font-bold text-xl flex items-center gap-2"><Activity className="h-5 w-5" />Admin Audit Log</h2>
          <p className="text-sm text-muted-foreground mt-1">Κάθε ενέργεια διαχειριστή — ποιος, πότε, τι.</p>
        </div>
        <Badge variant="outline" className="h-7">{filtered.length} εγγραφές</Badge>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Αναζήτηση σε actor, action, περιγραφή..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-56"><Filter className="h-3 w-3 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Όλες οι ενέργειες</SelectItem>
            {uniqueActions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>Ανανέωση</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border">
              {filtered.map(e => (
                <div key={e.id} className="px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`${actionColors[e.action] ?? 'bg-muted'} text-[10px]`}>
                          {e.action}
                        </Badge>
                        <span className="text-sm font-medium">{e.actor_name || `Admin ${e.actor_id.slice(0,8)}`}</span>
                        {e.target_type && <span className="text-xs text-muted-foreground">→ {e.target_type}</span>}
                        {e.target_id && <code className="text-[10px] font-mono text-muted-foreground">{e.target_id.slice(0,12)}</code>}
                      </div>
                      {e.description && <p className="text-sm text-muted-foreground mt-1">{e.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</p>
                      <p className="text-[10px] text-muted-foreground/60">{format(new Date(e.created_at), 'dd MMM, HH:mm:ss')}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!filtered.length && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Activity className="h-10 w-10 mb-2 opacity-30" />
                  <p className="text-sm">Καμία εγγραφή</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
