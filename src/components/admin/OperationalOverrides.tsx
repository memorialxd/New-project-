import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Zap, Plus, Trash2, Clock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format, isPast } from 'date-fns';

interface SurgeZone {
  id: string; name: string;
  latitude: number; longitude: number;
  radius_km: number; multiplier: number;
  is_active: boolean; expires_at: string | null;
  created_at: string;
}

const durationPresets = [
  { label: '30m', minutes: 30 }, { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 }, { label: '4h', minutes: 240 },
  { label: 'Forever', minutes: 0 },
];

export default function OperationalOverrides() {
  const [zones, setZones] = useState<SurgeZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', latitude: '', longitude: '',
    radius_km: '2', multiplier: '1.5', duration_min: 60,
  });

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)('surge_zones')
      .select('*').order('created_at', { ascending: false });
    setZones((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name || !form.latitude || !form.longitude) {
      return toast.error('Συμπλήρωσε όνομα και συντεταγμένες');
    }
    const expires_at = form.duration_min > 0
      ? new Date(Date.now() + form.duration_min * 60_000).toISOString()
      : null;
    const { error } = await (supabase.from as any)('surge_zones').insert({
      name: form.name,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      radius_km: Number(form.radius_km),
      multiplier: Number(form.multiplier),
      expires_at,
      is_active: true,
    });
    if (error) return toast.error(error.message);
    await (supabase.rpc as any)('log_admin_action', {
      p_action: 'surge_zone_create',
      p_target_type: 'surge_zone',
      p_description: `Δημιούργησε surge zone "${form.name}" ×${form.multiplier}`,
    });
    toast.success('Δημιουργήθηκε');
    setDialogOpen(false);
    setForm({ name: '', latitude: '', longitude: '', radius_km: '2', multiplier: '1.5', duration_min: 60 });
    load();
  };

  const toggle = async (z: SurgeZone) => {
    const { error } = await (supabase.from as any)('surge_zones')
      .update({ is_active: !z.is_active }).eq('id', z.id);
    if (error) return toast.error(error.message);
    setZones(prev => prev.map(x => x.id === z.id ? { ...x, is_active: !x.is_active } : x));
  };

  const remove = async (id: string) => {
    if (!confirm('Διαγραφή zone;')) return;
    const { error } = await (supabase.from as any)('surge_zones').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Διαγράφηκε');
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading font-bold text-xl flex items-center gap-2"><Zap className="h-5 w-5" />Operational Overrides</h2>
          <p className="text-sm text-muted-foreground mt-1">Surge pricing ανά ζώνη με προαιρετική λήξη.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Νέα Surge Zone</Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Όνομα</TableHead><TableHead>Συντεταγμένες</TableHead>
              <TableHead>Ακτίνα</TableHead><TableHead>Multiplier</TableHead>
              <TableHead>Λήξη</TableHead><TableHead>Ενεργό</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {zones.map(z => {
                const expired = z.expires_at && isPast(new Date(z.expires_at));
                return (
                  <TableRow key={z.id} className={expired ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{z.name}</TableCell>
                    <TableCell className="text-xs font-mono">{z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}</TableCell>
                    <TableCell>{z.radius_km} km</TableCell>
                    <TableCell><Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20">×{z.multiplier}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {z.expires_at ? (
                        <span className={expired ? 'text-destructive' : ''}>
                          <Clock className="h-3 w-3 inline mr-1" />
                          {format(new Date(z.expires_at), 'dd MMM HH:mm')}
                        </span>
                      ) : <Badge variant="outline" className="text-[10px]">Forever</Badge>}
                    </TableCell>
                    <TableCell><Switch checked={z.is_active} onCheckedChange={() => toggle(z)} /></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => remove(z.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
              {!zones.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Καμία surge zone</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Νέα Surge Zone</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Όνομα</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Κέντρο Αθήνας" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Latitude</Label>
                <Input value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} placeholder="37.9755" />
              </div>
              <div>
                <Label className="text-xs">Longitude</Label>
                <Input value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} placeholder="23.7348" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Ακτίνα (km)</Label>
                <Input type="number" step="0.1" value={form.radius_km} onChange={e => setForm({ ...form, radius_km: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Multiplier</Label>
                <Input type="number" step="0.1" value={form.multiplier} onChange={e => setForm({ ...form, multiplier: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Διάρκεια</Label>
              <Select value={String(form.duration_min)} onValueChange={v => setForm({ ...form, duration_min: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {durationPresets.map(p => <SelectItem key={p.label} value={String(p.minutes)}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Άκυρο</Button>
            <Button onClick={create}>Δημιουργία</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
