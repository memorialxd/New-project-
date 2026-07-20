import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShoppingBag, UserPlus, Store, Star, Wallet, MessageSquare, Activity } from 'lucide-react';
import { format } from 'date-fns';

interface ActivityItem {
  id: string;
  type: 'order' | 'user' | 'review' | 'ticket' | 'withdrawal';
  message: string;
  timestamp: string;
  icon: React.ElementType;
  color: string;
}

export default function AdminActivityLog() {
  const { data: recentOrders } = useQuery({
    queryKey: ['activity-orders'],
    queryFn: async () => {
      const { data } = await supabase.from('orders').select('id, status, total_amount, created_at').order('created_at', { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  const { data: recentProfiles } = useQuery({
    queryKey: ['activity-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role, created_at').order('created_at', { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const { data: recentTickets } = useQuery({
    queryKey: ['activity-tickets'],
    queryFn: async () => {
      const { data } = await supabase.from('support_tickets').select('id, category, status, created_at').order('created_at', { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const activities: ActivityItem[] = [
    ...(recentOrders?.map(o => ({
      id: `order-${o.id}`,
      type: 'order' as const,
      message: `Παραγγελία #${o.id.slice(0, 6)} — €${Number(o.total_amount).toFixed(2)} (${o.status})`,
      timestamp: o.created_at,
      icon: ShoppingBag,
      color: 'text-blue-500 bg-blue-500/10',
    })) ?? []),
    ...(recentProfiles?.map(p => ({
      id: `user-${p.id}`,
      type: 'user' as const,
      message: `Νέος χρήστης: ${p.full_name || 'Ανώνυμος'} (${p.role})`,
      timestamp: p.created_at,
      icon: UserPlus,
      color: 'text-emerald-500 bg-emerald-500/10',
    })) ?? []),
    ...(recentTickets?.map(t => ({
      id: `ticket-${t.id}`,
      type: 'ticket' as const,
      message: `Ticket: ${t.category} — ${t.status}`,
      timestamp: t.created_at,
      icon: MessageSquare,
      color: 'text-orange-500 bg-orange-500/10',
    })) ?? []),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 30);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading font-bold text-xl">Activity Log</h2>
        <p className="text-sm text-muted-foreground">Πρόσφατες ενέργειες στην πλατφόρμα</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${activity.color}`}>
                    <activity.icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{activity.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(activity.timestamp), 'dd MMM yyyy, HH:mm')}
                    </p>
                  </div>
                </div>
              ))}
              {!activities.length && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Activity className="h-10 w-10 mb-2 opacity-30" />
                  <p className="text-sm">Δεν υπάρχει πρόσφατη δραστηριότητα</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
