import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  showOrderStatusNotification,
  playStatusUpdateSound,
  requestNotificationPermission,
} from '@/lib/notifications';

const statusToastLabels: Record<string, string> = {
  accepted: 'Η παραγγελία σου έγινε δεκτή ✅',
  preparing: 'Ετοιμάζεται 👨‍🍳',
  ready: 'Έτοιμη — αναμένει οδηγό 📦',
  picked_up: 'Ο οδηγός είναι καθ’ οδόν 🛵',
  arrived: 'Ο οδηγός έφτασε 📍',
  delivered: 'Παραδόθηκε 🎉',
  cancelled: 'Η παραγγελία ακυρώθηκε ❌',
};

/**
 * Subscribe to the customer's own order status changes and surface a
 * browser notification + in-app toast + soft chime on every transition.
 *
 * Mount this hook once at the customer-app shell level.
 */
export function useCustomerOrderNotifications() {
  const { user } = useAuth();
  const lastStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!user) return;

    // Best-effort: ask for permission once when the hook mounts.
    requestNotificationPermission().catch(() => {});

    const channel = supabase
      .channel(`customer-orders-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `customer_id=eq.${user.id}`,
        },
        (payload) => {
          const next = payload.new as { id: string; status: string };
          const prev = lastStatusRef.current.get(next.id);
          if (prev === next.status) return;
          lastStatusRef.current.set(next.id, next.status);
          if (!prev) return; // first sighting — don't notify

          const label = statusToastLabels[next.status];
          if (label) {
            toast(label, { duration: 5000 });
            playStatusUpdateSound();
            showOrderStatusNotification(next.id, next.status);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);
}
