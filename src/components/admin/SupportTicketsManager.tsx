import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MessageSquare, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: 'Ανοιχτό', color: 'bg-red-500/10 text-red-600 border-red-500/20', icon: AlertTriangle },
  in_progress: { label: 'Σε εξέλιξη', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20', icon: Clock },
  resolved: { label: 'Επιλύθηκε', color: 'bg-green-500/10 text-green-600 border-green-500/20', icon: CheckCircle },
};

const categoryLabels: Record<string, string> = {
  long_wait: 'Μεγάλη Αναμονή',
  wrong_address: 'Λάθος Διεύθυνση',
  app_issue: 'Πρόβλημα Εφαρμογής',
  payment: 'Πληρωμή',
  accident: 'Ατύχημα',
  other: 'Άλλο',
};

export default function SupportTicketsManager() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [resolveTicketId, setResolveTicketId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['admin-tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['admin-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) throw error;
      return data;
    },
  });

  const getDriverName = (driverId: string) => {
    const p = profiles?.find((pr) => pr.user_id === driverId);
    return p?.full_name || driverId.slice(0, 8);
  };

  const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
    const { error } = await supabase
      .from('support_tickets')
      .update({ status: newStatus })
      .eq('id', ticketId);
    if (error) toast.error('Αποτυχία ενημέρωσης');
    else {
      toast.success('Κατάσταση ενημερώθηκε');
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    }
  };

  const handleResolve = async () => {
    if (!resolveTicketId) return;
    const { error } = await supabase
      .from('support_tickets')
      .update({ status: 'resolved', resolution_notes: resolutionNotes })
      .eq('id', resolveTicketId);
    if (error) toast.error('Αποτυχία');
    else {
      toast.success('Ticket επιλύθηκε');
      setResolveTicketId(null);
      setResolutionNotes('');
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    }
  };

  const filtered = tickets?.filter((t) => statusFilter === 'all' || t.status === statusFilter) ?? [];
  const openCount = tickets?.filter((t) => t.status === 'open').length ?? 0;
  const inProgressCount = tickets?.filter((t) => t.status === 'in_progress').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-red-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-500" />
            <div>
              <p className="text-xs text-muted-foreground">Ανοιχτά</p>
              <p className="font-heading font-bold text-2xl">{openCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-500" />
            <div>
              <p className="text-xs text-muted-foreground">Σε Εξέλιξη</p>
              <p className="font-heading font-bold text-2xl">{inProgressCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Επιλυμένα</p>
              <p className="font-heading font-bold text-2xl">{tickets?.filter((t) => t.status === 'resolved').length ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Tickets Υποστήριξης
          </CardTitle>
          <div className="flex gap-2">
            {['all', 'open', 'in_progress', 'resolved'].map((s) => (
              <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'Όλα' : statusConfig[s]?.label ?? s}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Οδηγός</TableHead>
                <TableHead>Κατηγορία</TableHead>
                <TableHead>Περιγραφή</TableHead>
                <TableHead>Κατάσταση</TableHead>
                <TableHead>Ημερομηνία</TableHead>
                <TableHead>Ενέργειες</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((ticket) => {
                const cfg = statusConfig[ticket.status] ?? statusConfig.open;
                return (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-semibold">{getDriverName(ticket.driver_id)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{categoryLabels[ticket.category] ?? ticket.category}</Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{ticket.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{format(new Date(ticket.created_at), 'dd MMM, HH:mm')}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {ticket.status !== 'resolved' && (
                          <>
                            <Select value={ticket.status} onValueChange={(v) => handleUpdateStatus(ticket.id, v)}>
                              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Ανοιχτό</SelectItem>
                                <SelectItem value="in_progress">Σε εξέλιξη</SelectItem>
                              </SelectContent>
                            </Select>
                            <Dialog open={resolveTicketId === ticket.id} onOpenChange={(o) => !o && setResolveTicketId(null)}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setResolveTicketId(ticket.id)}>
                                  <CheckCircle className="h-3 w-3 mr-1" />Επίλυση
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader><DialogTitle>Επίλυση Ticket</DialogTitle></DialogHeader>
                                <Textarea placeholder="Σημειώσεις επίλυσης..." value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
                                <Button onClick={handleResolve}>Αποθήκευση & Επίλυση</Button>
                              </DialogContent>
                            </Dialog>
                          </>
                        )}
                        {ticket.status === 'resolved' && ticket.resolution_notes && (
                          <span className="text-xs text-muted-foreground italic">{ticket.resolution_notes}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Δεν υπάρχουν tickets</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
