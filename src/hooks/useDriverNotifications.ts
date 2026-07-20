import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  ensureNotificationPermission,
  initNotificationChannels,
  showOsNotification,
} from '@/lib/push-notifications';

/**
 * Subscribes the logged-in driver to support-pushed notifications.
 * - Shows a sonner toast with appropriate severity
 * - Marks the row as read after display
 */
export function useDriverNotifications() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // Initialize OS-level notifications (asks permission once)
    void initNotificationChannels();
    void ensureNotificationPermission();

    // 1) Catch-up on any unread (sent while app was closed)
    (async () => {
      const { data } = await (supabase as any)
        .from('driver_notifications')
        .select('id, title, body, severity')
        .eq('driver_id', user.id)
        .is('read_at', null)
        .order('created_at', { ascending: true })
        .limit(10);

      (data ?? []).forEach((n: any) => showNotification(n));
      const ids = (data ?? []).map((n: any) => n.id);
      if (ids.length) {
        await (supabase as any)
          .from('driver_notifications')
          .update({ read_at: new Date().toISOString() })
          .in('id', ids);
      }
    })();

    // 2) Realtime stream
    const channel = supabase
      .channel(`driver-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'driver_notifications',
          filter: `driver_id=eq.${user.id}`,
        },
        async (payload) => {
          const n = payload.new as any;
          showNotification(n);
          await (supabase as any)
            .from('driver_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', n.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);
}

function showNotification(n: { title: string; body: string; severity: string }) {
  const opts = { description: n.body, duration: 10_000 };
  switch (n.severity) {
    case 'urgent':
      toast.error(`🚨 ${n.title}`, { ...opts, duration: 20_000 });
      break;
    case 'warning':
      toast.warning(`⚠️ ${n.title}`, opts);
      break;
    default:
      toast.info(`📢 ${n.title}`, opts);
  }
  // Also fire an OS-level notification so the driver hears/sees it when app
  // is in the background or screen is off.
  void showOsNotification({
    title: n.title,
    body: n.body,
    tag: 'driver-notif',
    vibrate: n.severity === 'urgent' || n.severity === 'warning',
  });
}
