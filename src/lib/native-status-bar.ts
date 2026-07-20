import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function initNativeStatusBar() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // Make WebView draw behind status bar for true full-screen
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setBackgroundColor({ color: '#00000000' });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.hide().catch(() => {});
    await StatusBar.show();
  } catch {
    // Ignore native status bar setup failures.
  }

  // Mark document as native so CSS can drop web-only chrome
  document.documentElement.classList.add('is-native');
}
