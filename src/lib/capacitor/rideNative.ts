/**
 * Getters que cargan APIs de Capacitor solo en runtime (navegador/app).
 * Cero imports estáticos de @capacitor para que el build de Next (Vercel) no falle.
 */

export async function getCapacitor() {
  if (typeof window === 'undefined') return null;
  const { Capacitor } = await import('@capacitor/core');
  return Capacitor;
}

export async function getApp() {
  if (typeof window === 'undefined') return null;
  const { App } = await import('@capacitor/app');
  return App;
}

export async function getBrowser() {
  if (typeof window === 'undefined') return null;
  const { Browser } = await import('@capacitor/browser');
  return Browser;
}

export async function getAppLauncher() {
  if (typeof window === 'undefined') return null;
  const { AppLauncher } = await import('@capacitor/app-launcher');
  return AppLauncher;
}

export async function getGeolocation() {
  if (typeof window === 'undefined') return null;
  const { Geolocation } = await import('@capacitor/geolocation');
  return Geolocation;
}

export async function isNativePlatform(): Promise<boolean> {
  const Capacitor = await getCapacitor();
  return Capacitor?.isNativePlatform() ?? false;
}
