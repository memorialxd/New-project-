import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const isNative = Capacitor.isNativePlatform();

let permissionRequested = false;
let permissionGranted = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionRequested) return permissionGranted;
  permissionRequested = true;

  try {
    if (isNative) {
      const perm = await LocalNotifications.requestPermissions();
      permissionGranted = perm.display === 'granted';
    } else if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        permissionGranted = true;
      } else if (Notification.permission !== 'denied') {
        const r = await Notification.requestPermission();
        permissionGranted = r === 'granted';
      }
    }
  } catch (e) {
    console.warn('Notification permission error', e);
  }
  return permissionGranted;
}

export async function showOsNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  vibrate?: boolean;
}) {
  if (!permissionGranted) return;
  try {
    if (isNative) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 2_147_483_647),
            title: opts.title,
            body: opts.body,
            schedule: { at: new Date(Date.now() + 50) },
            smallIcon: 'ic_stat_icon_config_sample',
            channelId: 'driver-offers',
          },
        ],
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      // Use ServiceWorker registration when available so notifications persist
      const reg = 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration().catch(() => null)
        : null;
      const init: NotificationOptions = {
        body: opts.body,
        tag: opts.tag,
        // @ts-expect-error vibrate not in TS lib for all browsers
        vibrate: opts.vibrate ? [200, 100, 200] : undefined,
        icon: '/favicon.svg',
      };
      if (reg) {
        await reg.showNotification(opts.title, init);
      } else {
        new Notification(opts.title, init);
      }
    }
  } catch (e) {
    console.warn('showOsNotification failed', e);
  }
}

// Set up Android channel for high-priority offer alerts
export async function initNotificationChannels() {
  if (!isNative) return;
  try {
    await LocalNotifications.createChannel({
      id: 'driver-offers',
      name: 'Νέες παραγγελίες',
      description: 'Ειδοποιήσεις για νέες παραγγελίες προς ανάθεση',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
    });
  } catch (e) {
    console.warn('createChannel error', e);
  }
}
