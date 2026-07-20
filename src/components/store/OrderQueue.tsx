import { useEffect, useRef, useState } from 'react';
import { Clock, User, Car, ChevronRight, Timer, Plus, Minus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PrintTicketButton, printOrderTicket } from './PrintOrderTicket';
import { getPrinterPrefs } from '@/lib/printer-prefs';
import type { OrderWithItems } from '@/hooks/useOrders';
import { formatOrderNumber } from '@/lib/order-number';

interface OrderQueueProps {
  orders: OrderWithItems[];
  onStatusUpdate: (orderId: string, newStatus: string, options?: { estimatedPrepTime?: number }) => void;
  storeName?: string;
}

const statusConfig: Record<string, { label: string; variant: 'destructive' | 'default' | 'secondary'; bg: string }> = {
  placed: { label: 'Νέα', variant: 'destructive', bg: 'bg-primary/10 border-primary/30' },
  accepted: { label: 'Αποδεκτή', variant: 'default', bg: 'bg-info/10 border-info/30' },
  preparing: { label: 'Σε Εξέλιξη', variant: 'default', bg: 'bg-warning/10 border-warning/30' },
  ready: { label: 'Έτοιμη', variant: 'secondary', bg: 'bg-success/10 border-success/30' },
};

const PREP_PRESETS = [10, 15, 20, 30, 45];

export function OrderQueue({ orders, onStatusUpdate, storeName = 'Κατάστημα' }: OrderQueueProps) {
  // Per-order chosen prep time (before acceptance)
  const [prepTimes, setPrepTimes] = useState<Record<string, number>>({});
  // Track which orders have already been auto-printed in this session
  const printedRef = useRef<Set<string>>(new Set());

  const getTimeSince = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    return diff < 1 ? 'Μόλις τώρα' : `${diff}λ πριν`;
  };

  const getNextAction = (status: string) => {
    switch (status) {
      case 'placed': return { label: 'Αποδοχή & Έναρξη Ετοιμασίας', next: 'preparing' };
      case 'accepted': return { label: 'Έναρξη Ετοιμασίας', next: 'preparing' };
      case 'preparing': return { label: 'Σημείωση Έτοιμη', next: 'ready' };
      case 'ready': return null;
      default: return null;
    }
  };

  const setPrep = (orderId: string, value: number) => {
    setPrepTimes(prev => ({ ...prev, [orderId]: Math.max(5, Math.min(120, value)) }));
  };

  const getPrep = (order: OrderWithItems) =>
    prepTimes[order.id] ?? order.estimated_prep_time ?? 20;

  // Auto-print when an order moves into accepted or preparing
  useEffect(() => {
    const prefs = getPrinterPrefs();
    if (!prefs.enabled || !prefs.autoPrintOnAccept) return;
    for (const order of orders) {
      if ((order.status === 'accepted' || order.status === 'preparing') && !printedRef.current.has(order.id)) {
        printedRef.current.add(order.id);
        try {
          printOrderTicket(order, storeName);
        } catch {
          // ignore — popup blockers etc.
        }
      }
    }
  }, [orders, storeName]);

  const handleAdvance = (order: OrderWithItems, nextStatus: string) => {
    if (order.status === 'placed') {
      const prep = getPrep(order);
      onStatusUpdate(order.id, nextStatus, { estimatedPrepTime: prep });
    } else {
      onStatusUpdate(order.id, nextStatus);
    }
  };

  return (
    <div className="space-y-3">
      {orders.map(order => {
        const config = statusConfig[order.status] || statusConfig.placed;
        const nextAction = getNextAction(order.status);
        const items = order.order_items || [];
        const currentPrep = getPrep(order);

        return (
          <Card key={order.id} className={`border-2 ${config.bg} shadow-[var(--shadow-md)] overflow-hidden`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant={config.variant} className="font-heading font-semibold flex-shrink-0">
                    {config.label}
                  </Badge>
                  <span className="text-sm font-mono font-bold text-foreground truncate">{formatOrderNumber(order)}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                    <Clock className="h-3.5 w-3.5" />
                    {getTimeSince(order.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
                  <PrintTicketButton order={order} storeName={storeName} />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:bg-destructive/10"
                        disabled={!!order.driver_id}
                        title={order.driver_id ? 'Έχει ανατεθεί σε οδηγό — επικοινώνησε με υποστήριξη' : 'Ακύρωση παραγγελίας'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Ακύρωση παραγγελίας {formatOrderNumber(order)};</AlertDialogTitle>
                        <AlertDialogDescription>
                          Η παραγγελία θα μαρκαριστεί ως ακυρωμένη και θα αφαιρεθεί από την ουρά.
                          Αν ο πελάτης έχει χρεωθεί, χρησιμοποίησε επιστροφή χρημάτων ξεχωριστά.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Όχι</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            const { error } = await supabase
                              .from('orders')
                              .update({ status: 'cancelled' as any })
                              .eq('id', order.id);
                            if (error) toast.error('Η ακύρωση απέτυχε');
                            else toast.success('Παραγγελία ακυρώθηκε');
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Ναι, ακύρωση
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <div className="space-y-1 mb-3">
                {items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.quantity}x {item.name}</span>
                    <span className="text-muted-foreground">€{Number(item.unit_price).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-heading font-semibold pt-2 border-t border-border">
                  <span className="text-foreground">Σύνολο</span>
                  <span className="text-foreground">€{Number(order.total_amount).toFixed(2)}</span>
                </div>
              </div>

              {order.driver_id && (
                <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-card mb-3">
                  <Car className="h-4 w-4 text-info" />
                  <span className="text-sm text-foreground">Οδηγός ανατέθηκε</span>
                </div>
              )}

              {order.status === 'placed' && (
                <div className="rounded-lg bg-card border border-border p-3 mb-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-primary" />
                    <span className="font-heading text-sm font-semibold text-foreground">
                      Χρόνος ετοιμασίας
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => setPrep(order.id, currentPrep - 5)}
                      aria-label="Μείωση χρόνου"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <div className="flex-1 text-center">
                      <span className="font-heading font-bold text-2xl text-foreground">{currentPrep}</span>
                      <span className="text-sm text-muted-foreground ml-1">λεπτά</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => setPrep(order.id, currentPrep + 5)}
                      aria-label="Αύξηση χρόνου"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PREP_PRESETS.map(p => (
                      <Button
                        key={p}
                        type="button"
                        variant={currentPrep === p ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 px-2.5 text-xs font-heading"
                        onClick={() => setPrep(order.id, p)}
                      >
                        {p}λ
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {order.status !== 'placed' && order.estimated_prep_time && order.estimated_prep_time > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning mb-3">
                  <Timer className="h-4 w-4" />
                  <span>~{order.estimated_prep_time} λεπτά απομένουν</span>
                </div>
              )}

              {order.notes && (
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-2 mb-3">
                  📝 {order.notes}
                </div>
              )}

              {nextAction && (
                <Button
                  className={`w-full h-12 font-heading font-semibold ${
                    order.status === 'placed'
                      ? 'gradient-primary shadow-primary text-primary-foreground'
                      : 'gradient-success text-success-foreground'
                  }`}
                  onClick={() => handleAdvance(order, nextAction.next)}
                >
                  {nextAction.label}
                  <ChevronRight className="ml-1 h-5 w-5" />
                </Button>
              )}

              {order.status === 'ready' && (
                <div className="text-center py-2">
                  <span className="text-sm text-success font-heading font-semibold">
                    ✓ Αναμονή παραλαβής από οδηγό
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
