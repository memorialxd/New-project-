import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Flame, Plus, X } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

export default function SurgeMap() {
  const qc = useQueryClient();
  const [zoneId, setZoneId] = useState<string>('');
  const [multiplier, setMultiplier] = useState<string>('1.5');
  const [duration, setDuration] = useState<string>('60');
  const [reason, setReason] = useState<string>('');

  const zones = useQuery({
    queryKey: ['demand-zones'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('demand_zones').select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const overrides = useQuery({
    queryKey: ['surge-overrides'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('surge_overrides').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const events = useQuery({
    queryKey: ['surge-events'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('surge_events').select('*').order('started_at', { ascending: false }).limit(40);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const zoneName = (id: string | null) => zones.data?.find(z => z.id === id)?.name ?? '— Όλες οι ζώνες —';

  const addOverride = async () => {
    const m = parseFloat(multiplier);
    const dur = parseInt(duration, 10);
    if (!m || m < 1 || m > 5) return toast.error('Πολλαπλασιαστής 1.0–5.0');
    if (!dur || dur < 5) return toast.error('Διάρκεια ≥ 5 λεπτά');
    const ends = new Date(Date.now() + dur * 60_000).toISOString();
    const { error } = await (supabase as any).from('surge_overrides').insert({
      zone_id: zoneId || null, multiplier: m, expires_at: ends, reason: reason || null,
    });
    if (error) return toast.error(error.message);
    toast.success('Surge override ενεργό');
    setReason('');
    qc.invalidateQueries({ queryKey: ['surge-overrides'] });
  };

  const cancelOverride = async (id: string) => {
    const { error } = await (supabase as any).from('surge_overrides').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Override ακυρώθηκε');
    qc.invalidateQueries({ queryKey: ['surge-overrides'] });
  };

  const activeOverrides = (overrides.data ?? []).filter((o: any) => !o.expires_at || new Date(o.expires_at) > new Date());

  return (
    <div className="space-y-3">
      {/* Compose override */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Flame className="h-4 w-4 text-warning" /> Χειροκίνητο Surge Override
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Παρακάμπτει αυτόματο surge από ζήτηση/προσφορά και χρονικά παράθυρα. Ισχύει μόνο για το διάστημα που ορίζεις.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <Label className="text-xs">Ζώνη</Label>
              <Select value={zoneId || '__all__'} onValueChange={(v) => setZoneId(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Όλες οι ζώνες" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Όλες οι ζώνες</SelectItem>
                  {(zones.data ?? []).map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Πολλαπλασιαστής</Label>
              <Input type="number" step="0.1" min="1" max="5" value={multiplier} onChange={e => setMultiplier(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Διάρκεια (λεπτά)</Label>
              <Input type="number" min="5" value={duration} onChange={e => setDuration(e.target.value)} className="h-9 mt-1" />
            </div>
            <div className="flex items-end">
              <Button onClick={addOverride} className="h-9 w-full"><Plus className="h-4 w-4 mr-1" /> Ενεργοποίηση</Button>
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <Label className="text-xs">Λόγος (προαιρετικό)</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="π.χ. βροχή, εκδήλωση…" className="h-9 mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active overrides */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Ενεργά overrides</CardTitle></CardHeader>
        <CardContent className="p-0">
          {overrides.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : activeOverrides.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Κανένα ενεργό override.</p>
          ) : (
            <div className="divide-y divide-border">
              {activeOverrides.map((o: any) => (
                <div key={o.id} className="flex items-center gap-3 p-3">
                  <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center text-warning shrink-0">
                    <Flame className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{zoneName(o.zone_id)}</span>
                      <Badge className="bg-warning/15 text-warning border-warning/30">×{Number(o.multiplier).toFixed(2)}</Badge>
                      {o.expires_at && <Badge variant="outline" className="text-[10px]">λήγει {formatDistanceToNow(new Date(o.expires_at), { addSuffix: true })}</Badge>}
                    </div>
                    {o.reason && <p className="text-[11px] text-muted-foreground mt-0.5">{o.reason}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => cancelOverride(o.id)}><X className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Surge log */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Ιστορικό Surge</CardTitle></CardHeader>
        <CardContent className="p-0">
          {events.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (events.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν surge events ακόμη.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Ώρα</TableHead><TableHead>Ζώνη</TableHead>
                  <TableHead>Πηγή</TableHead><TableHead className="text-right">×</TableHead>
                  <TableHead>Λόγος</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(events.data ?? []).map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(e.started_at), 'dd/MM HH:mm')}</TableCell>
                      <TableCell className="text-xs">{zoneName(e.zone_id)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{e.source}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">×{Number(e.multiplier).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{e.reason ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
