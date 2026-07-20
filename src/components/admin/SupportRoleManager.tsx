import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Headphones, Loader2, Search, UserPlus, UserMinus } from 'lucide-react';

interface Profile { user_id: string; full_name: string | null; }

export default function SupportRoleManager() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [supportIds, setSupportIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name').order('full_name'),
      supabase.from('user_roles').select('user_id, role').eq('role', 'support'),
    ]);
    setProfiles((p.data ?? []) as any);
    setSupportIds(new Set(((r.data ?? []) as any[]).map(x => x.user_id)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggle = async (userId: string, currentlySupport: boolean) => {
    setBusy(userId);
    let error;
    if (currentlySupport) {
      ({ error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'support'));
    } else {
      ({ error } = await supabase.from('user_roles').insert({ user_id: userId, role: 'support' as any }));
    }
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(currentlySupport ? 'Αφαιρέθηκε ρόλος support' : 'Εκχωρήθηκε ρόλος support');
    setSupportIds(prev => {
      const next = new Set(prev);
      currentlySupport ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const filtered = profiles.filter(p =>
    !search || (p.full_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="font-heading font-bold text-xl flex items-center gap-2"><Headphones className="h-5 w-5" />Διαχείριση Support Agents</h2>
        <p className="text-sm text-muted-foreground mt-1">Εκχώρησε ή αφαίρεσε τον ρόλο support από οποιονδήποτε χρήστη.</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Αναζήτηση χρήστη..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Όνομα</TableHead><TableHead>Ρόλος</TableHead><TableHead className="w-32">Ενέργεια</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map(p => {
                const isSupport = supportIds.has(p.user_id);
                return (
                  <TableRow key={p.user_id}>
                    <TableCell className="font-medium">{p.full_name || '—'}</TableCell>
                    <TableCell>{isSupport ? <Badge>Support</Badge> : <Badge variant="outline">—</Badge>}</TableCell>
                    <TableCell>
                      <Button size="sm" variant={isSupport ? 'outline' : 'default'} disabled={busy === p.user_id} onClick={() => toggle(p.user_id, isSupport)}>
                        {isSupport ? <UserMinus className="h-3 w-3 mr-1" /> : <UserPlus className="h-3 w-3 mr-1" />}
                        {isSupport ? 'Αφαίρεση' : 'Εκχώρηση'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Δεν βρέθηκαν χρήστες</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
