/**
 * Plugin de ubicación en segundo plano. Capacitor se carga solo en cliente
 * para no romper el build de Next.js (Vercel).
 */
export type BackgroundLocationPlugin = {
  startTracking(options: {
    serverUrl: string;
    rideId: string;
    token: string;
    intervalMs?: number;
  }): Promise<{ started: boolean }>;
  stopTracking(): Promise<{ stopped: boolean }>;
  addListener(eventName: 'sessionExpired', callback: () => void): Promise<{ remove: () => Promise<void> }>;
  openAppSettings(): Promise<void>;
  getDeviceInfo(): Promise<{ manufacturer: string }>;
  openBatterySettings(): Promise<void>;
};

const noopRemove = async () => {};

const noopImpl: BackgroundLocationPlugin = {
  startTracking: async () => ({ started: false }),
  stopTracking: async () => ({ stopped: false }),
  addListener: async () => ({ remove: noopRemove }),
  openAppSettings: async () => {},
  getDeviceInfo: async () => ({ manufacturer: '' }),
  openBatterySettings: async () => {},
};

function isPluginNotImplemented(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /not implemented|plugin.*not found/i.test(msg);
}

let cachedPlugin: BackgroundLocationPlugin | null = null;

async function getPlugin(): Promise<BackgroundLocationPlugin> {
  if (cachedPlugin) return cachedPlugin;
  if (typeof window === 'undefined') return noopImpl;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return noopImpl;
    const { registerPlugin } = await import('@capacitor/core');
    const native = registerPlugin<BackgroundLocationPlugin>('BackgroundLocation');
    cachedPlugin = {
    startTracking: async (opts) => {
      try {
        return await native.startTracking(opts);
      } catch (e) {
        if (isPluginNotImplemented(e)) return { started: false };
        throw e;
      }
    },
    stopTracking: async () => {
      try {
        return await native.stopTracking();
      } catch (e) {
        if (isPluginNotImplemented(e)) return { stopped: false };
        throw e;
      }
    },
    addListener: async (eventName, callback) => {
      try {
        return await native.addListener(eventName, callback);
      } catch (e) {
        if (isPluginNotImplemented(e)) return { remove: noopRemove };
        throw e;
      }
    },
    openAppSettings: async () => {
      try {
        await native.openAppSettings();
      } catch (e) {
        if (isPluginNotImplemented(e)) return;
        throw e;
      }
    },
    getDeviceInfo: async () => {
      try {
        return await native.getDeviceInfo();
      } catch (e) {
        if (isPluginNotImplemented(e)) return { manufacturer: '' };
        throw e;
      }
    },
    openBatterySettings: async () => {
      try {
        await native.openBatterySettings();
      } catch (e) {
        if (isPluginNotImplemented(e)) return;
        throw e;
      }
    },
    };
    return cachedPlugin;
  } catch {
    return noopImpl;
  }
}

export const BackgroundLocation: BackgroundLocationPlugin = {
  startTracking: (opts) => getPlugin().then((p) => p.startTracking(opts)),
  stopTracking: () => getPlugin().then((p) => p.stopTracking()),
  addListener: (eventName, callback) => getPlugin().then((p) => p.addListener(eventName, callback)),
  openAppSettings: () => getPlugin().then((p) => p.openAppSettings()),
  getDeviceInfo: () => getPlugin().then((p) => p.getDeviceInfo()),
  openBatterySettings: () => getPlugin().then((p) => p.openBatterySettings()),
};

