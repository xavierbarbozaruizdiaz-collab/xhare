import type { CapacitorConfig } from '@capacitor/cli';

// URL de producción: el APK debe cargar la app desde aquí para no quedar en blanco (webDir solo tiene index stub).
const PRODUCTION_URL = 'https://xhare-ashy.vercel.app';

// Prioridad: 1) CAP_LIVE_RELOAD=1 -> dev local | 2) CAP_APP_URL -> override | 3) producción por defecto.
const isLiveReload = process.env.CAP_LIVE_RELOAD === '1';
const appUrl = process.env.CAP_APP_URL ?? PRODUCTION_URL;

const config: CapacitorConfig = {
  appId: 'com.xhare.app',
  appName: 'Xhare',
  webDir: 'public',
  ...(isLiveReload
    ? { server: { url: 'http://10.0.2.2:3000', cleartext: true } }
    : { server: { url: appUrl, cleartext: appUrl.startsWith('http://') } }),
};

export default config;
