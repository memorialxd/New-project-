import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.a8538a5288f34701a1b9d56a6120ba4c',
  appName: 'Fresh Delivery',
  webDir: 'dist',
  server: {
    url: 'https://a8538a52-88f3-4701-a1b9-d56a6120ba4c.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  android: {
    backgroundColor: '#1a1a2e',
    webContentsDebuggingEnabled: true,
    allowMixedContent: true,
  },
  ios: {
    backgroundColor: '#1a1a2e',
    contentInset: 'never',
    scrollEnabled: false,
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
      overlaysWebView: true,
    },
    SplashScreen: {
      backgroundColor: '#1a1a2e',
    },
  },
};

export default config;
