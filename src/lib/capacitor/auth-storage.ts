/**
 * Storage adapter para Supabase Auth que persiste la sesión en app nativa (Capacitor).
 * En Android/iOS el WebView puede limpiar localStorage al pasar la app a segundo plano;
 * Capacitor Preferences persiste en disco y evita que se cierre sesión al abrir otra app (ej. navegación).
 */
export type AuthStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

async function isNativePlatform(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export const capacitorAuthStorage: AuthStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    try {
      if (await isNativePlatform()) {
        const { Preferences } = await import('@capacitor/preferences');
        const { value } = await Preferences.get({ key });
        if (value != null) return value;
        const fromLocal = localStorage.getItem(key);
        if (fromLocal != null) {
          await Preferences.set({ key, value: fromLocal });
          return fromLocal;
        }
        return null;
      }
    } catch {
      // fallback a localStorage
    }
    return localStorage.getItem(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      if (await isNativePlatform()) {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.set({ key, value });
        return;
      }
    } catch {
      // fallback
    }
    localStorage.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      if (await isNativePlatform()) {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.remove({ key });
        return;
      }
    } catch {
      // fallback
    }
    localStorage.removeItem(key);
  },
};
