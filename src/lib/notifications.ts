// Notification utilities used across the apps (store, driver, customer).
import { showOsNotification, ensureNotificationPermission } from './push-notifications';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playTones(frequencies: number[], type: OscillatorType = 'sine', duration = 0.15, gap = 0.12, gainPeak = 0.3) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t0 = now + i * (duration + gap);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    });
  } catch (e) {
    console.warn('Could not play sound:', e);
  }
}

/**
 * Play a notification chime (classic order bell — ascending C major chord).
 */
export function playOrderSound() {
  playTones([523.25, 659.25, 783.99]);
}

/**
 * Play a driver delivery alert — two quick low tones.
 */
export function playDeliverySound() {
  playTones([440, 554.37], 'triangle', 0.18, 0.1, 0.35);
}

/**
 * Play a soft status-update chime — single short tone for customers.
 */
export function playStatusUpdateSound() {
  playTones([880], 'sine', 0.18, 0, 0.18);
}

/**
 * Request notification permission. Returns true if granted.
 * Uses Capacitor LocalNotifications on native, web Notification API in browser.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  return ensureNotificationPermission();
}

/**
 * Show a browser notification for a new order (store).
 */
export function showOrderNotification(orderId: string, itemCount: number) {
  void showOsNotification({
    title: '🔔 Νέα Παραγγελία!',
    body: `Παραγγελία #${orderId.slice(0, 6)} — ${itemCount} προϊόν${itemCount !== 1 ? 'τα' : ''}`,
    tag: `order-${orderId}`,
    vibrate: true,
  });
}

/**
 * Show a browser notification for a new delivery offer (driver).
 */
export function showDeliveryNotification(estimatedPayout: number) {
  void showOsNotification({
    title: '📦 Νέα Παράδοση!',
    body: `Εκτιμώμενη αμοιβή: €${estimatedPayout.toFixed(2)} — Πάτα για προβολή`,
    tag: `delivery-${Date.now()}`,
    vibrate: true,
  });
}

/**
 * Customer-facing labels for order status push notifications.
 */
const customerStatusLabels: Record<string, { title: string; body: string }> = {
  accepted:  { title: '✅ Παραγγελία αποδεκτή', body: 'Το κατάστημα έλαβε την παραγγελία σου.' },
  preparing: { title: '👨‍🍳 Ετοιμάζεται',         body: 'Η παραγγελία σου ετοιμάζεται.' },
  ready:     { title: '📦 Έτοιμη για παραλαβή',  body: 'Έτοιμη — αναμένει τον οδηγό.' },
  picked_up: { title: '🛵 Σε μεταφορά',           body: 'Ο οδηγός είναι καθ’ οδόν!' },
  arrived:   { title: '📍 Ο οδηγός έφτασε',        body: 'Ο οδηγός είναι κοντά σου.' },
  delivered: { title: '🎉 Παραδόθηκε',             body: 'Καλή σου όρεξη! Άφησε μια κριτική 💛' },
  cancelled: { title: '❌ Ακυρώθηκε',              body: 'Η παραγγελία σου ακυρώθηκε.' },
};

/**
 * Show a browser notification for a customer order status update.
 * Returns true if a notification was shown.
 */
export function showOrderStatusNotification(orderId: string, status: string): boolean {
  const cfg = customerStatusLabels[status];
  if (!cfg) return false;
  void showOsNotification({
    title: cfg.title,
    body: `${cfg.body} (Παραγγελία #${orderId.slice(0, 6)})`,
    tag: `customer-order-${orderId}`,
  });
  return true;
}
