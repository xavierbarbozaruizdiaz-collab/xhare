import type { CapacitorConfig } from '@capacitor/cli';

// Prioridad: 1) CAP_LIVE_RELOAD=1 -> server.url='http://10.0.2.2:3000' | 2) CAP_APP_URL -> server.url=CAP_APP_URL | 3) ninguno -> no server.
const isLiveReload = process.env.CAP_LIVE_RELOAD === '1';
const appUrl = process.env.CAP_APP_URL; // ej. https://tu-app.vercel.app — solo para builds, no hardcodear.

const config: CapacitorConfig = {
  appId: 'com.xhare.app',
  appName: 'Xhare',
  webDir: 'public',
  ...(isLiveReload
    ? { server: { url: 'http://10.0.2.2:3000', cleartext: true } }
    : appUrl
      ? { server: { url: appUrl, cleartext: appUrl.startsWith('http://') } }
      : {}),
};

export default config;
