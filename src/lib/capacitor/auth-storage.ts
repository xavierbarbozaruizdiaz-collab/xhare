/**
 * Storage adapter para Supabase Auth.
 * Usamos el stub (localStorage) por ruta relativa para que el build nunca intente
 * resolver el paquete @capacitor/preferences (evita "Module not found" en Vercel).
 */
import { Preferences } from './preferences-stub';

export type AuthStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export const capacitorAuthStorage: AuthStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    try {
      const { value } = await Preferences.get({ key });
      if (value != null) return value;
      const fromLocal = localStorage.getItem(key);
      if (fromLocal != null) {
        await Preferences.set({ key, value: fromLocal });
        return fromLocal;
      }
      return null;
    } catch {
      return localStorage.getItem(key);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      await Preferences.set({ key, value });
    } catch {
      localStorage.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      await Preferences.remove({ key });
    } catch {
      localStorage.removeItem(key);
    }
  },
};
