import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Profile { user_id: string; full_name: string | null; }
interface Permission {
  id: string; user_id: string; scope: string;
  can_manage_finances: boolean; can_manage_users: boolean;
  can_manage_orders: boolean; can_manage_settings: boolean;
  can_view_audit: boolean; notes: string | null;
}

export default function AdminPermissionsManager() {
  const [admins, setAdmins] = useState<Profile[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Permission | null>(null);

  const load = async () => {
    setLoading(true);
    const [r, p, pp] = await Promise.all([
      supabase.from('user_roles').select('user_id, role').eq('role', 'admin'),
      supabase.from('profiles').select('user_id, full_name'),
      supabase.from('admin_permissions').select('*'),
    ]);
    const adminIds = new Set((r.data ?? []).map((x) => x.user_id));
    setAdmins(((p.data ?? []) as Profile[]).filter((x) => adminIds.has(x.user_id)));
    setPerms((pp.data ?? []) as Permission[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (userId: string) => {
    const existing = perms.find(p => p.user_id === userId);
    setEditing(existing ?? {
      id: '', user_id: userId, scope: 'custom',
      can_manage_finances: false, can_manage_users: false,
      can_manage_orders: false, can_manage_settings: false,
      can_view_audit: false, notes: null,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    const payload = {
      user_id: editing.user_id, scope: editing.scope,
      can_manage_finances: editing.can_manage_finances,
      can_manage_users: editing.can_manage_users,
      can_manage_orders: editing.can_manage_orders,
      can_manage_settings: editing.can_manage_settings,
      can_view_audit: editing.can_view_audit,
      notes: editing.notes,
    };
    const { error } = await supabase.from('admin_permissions').upsert(payload, { onConflict: 'user_id' });
    if (error) return toast.error(error.message);
    await supabase.rpc('log_admin_action', {
      p_action: 'grant_permission',
      p_target_type: 'admin',
      p_target_id: editing.user_id,
      p_description: `Όρισε permissions: ${editing.scope}`,
    });
    toast.success('Αποθηκεύτηκε');
    setDialogOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Διαγραφή permissions;')) return;
    const { error } = await supabase.from('admin_permissions').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Διαγράφηκε');
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h2 className="font-heading font-bold text-xl flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Admin Permissions</h2>
        <p className="text-sm text-muted-foreground mt-1">Ανάθεσε granular permissions στους admins (read-only, finance, support κ.λπ.).</p>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Admin</TableHead><TableHead>Scope</TableHead>
              <TableHead>Permissions</TableHead><TableHead className="w-32">Ενέργεια</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {admins.map(a => {
                const p = perms.find(x => x.user_id === a.user_id);
                const flags = p ? [
                  p.can_manage_finances && 'finances',
                  p.can_manage_users && 'users',
                  p.can_manage_orders && 'orders',
                  p.can_manage_settings && 'settings',
                  p.can_view_audit && 'audit',
                ].filter(Boolean) as string[] : [];
                return (
                  <TableRow key={a.user_id}>
                    <TableCell className="font-medium">{a.full_name || a.user_id.slice(0, 8)}</TableCell>
                    <TableCell>
                      <Badge variant={p?.scope === 'full' ? 'default' : 'outline'}>{p?.scope ?? 'full (default)'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {!p && <span className="text-xs text-muted-foreground">Όλα (default)</span>}
                        {flags.map(f => <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>)}
                        {p && !flags.length && <Badge variant="outline" className="text-[10px] text-muted-foreground">read-only</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => openEdit(a.user_id)}>
                          {p ? 'Επεξεργασία' : <><Plus className="h-3 w-3 mr-1" />Όρισε</>}
                        </Button>
                        {p && <Button size="sm" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!admins.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Δεν υπάρχουν admins</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Permissions</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Scope (preset)</Label>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {[
                    { id: 'full', label: 'Full Access', perms: { fin: true, usr: true, ord: true, set: true, aud: true } },
                    { id: 'finance', label: 'Finance Only', perms: { fin: true, usr: false, ord: false, set: false, aud: true } },
                    { id: 'support', label: 'Support', perms: { fin: false, usr: true, ord: true, set: false, aud: false } },
                    { id: 'readonly', label: 'Read Only', perms: { fin: false, usr: false, ord: false, set: false, aud: true } },
                    { id: 'custom', label: 'Custom', perms: null as any },
                  ].map(s => (
                    <Button key={s.id} size="sm" variant={editing.scope === s.id ? 'default' : 'outline'}
                      onClick={() => setEditing(prev => prev && {
                        ...prev, scope: s.id,
                        ...(s.perms ? {
                          can_manage_finances: s.perms.fin,
                          can_manage_users: s.perms.usr,
                          can_manage_orders: s.perms.ord,
                          can_manage_settings: s.perms.set,
                          can_view_audit: s.perms.aud,
                        } : {}),
                      })}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>

              {[
                { key: 'can_manage_finances', label: 'Διαχείριση οικονομικών (refunds, wallets, withdrawals)' },
                { key: 'can_manage_users', label: 'Διαχείριση χρηστών (suspend, roles, ban)' },
                { key: 'can_manage_orders', label: 'Διαχείριση παραγγελιών (override, cancel, reassign)' },
                { key: 'can_manage_settings', label: 'Επεξεργασία platform settings & feature flags' },
                { key: 'can_view_audit', label: 'Προβολή audit log' },
              ].map(p => (
                <div key={p.key} className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-normal flex-1">{p.label}</Label>
                  <Switch
                    checked={editing[p.key as keyof Permission] as boolean}
                    onCheckedChange={(v) => setEditing(prev => prev && ({ ...prev, [p.key]: v }))}
                  />
                </div>
              ))}

              <div>
                <Label className="text-xs">Σημειώσεις</Label>
                <Input value={editing.notes ?? ''} onChange={e => setEditing(prev => prev && ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Άκυρο</Button>
            <Button onClick={save}>Αποθήκευση</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
