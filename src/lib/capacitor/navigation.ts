/**
 * Único punto de acceso al plugin nativo Navigation.
 * Todas las llamadas de navegación y preferencias pasan por aquí para:
 * - Evitar registerPlugin disperso y asegurar que el bridge vea el mismo plugin.
 * - Poder diagnosticar cuando el plugin no está disponible (APK vs web, bridge no listo).
 */

/** Forma que devuelve el plugin nativo (evita depender de platform.ts). */
export type NavigationAppOptionFromPlugin = { id: string; label: string; available: boolean };

export type NavigationPluginNative = {
  openNativeNavigation(options: { lat: number; lng: number }): Promise<void>;
  getPreference(): Promise<{ value: string }>;
  setPreference(options: { value: string }): Promise<void>;
  getAvailableApps(): Promise<{ value: NavigationAppOptionFromPlugin[] }>;
};

const GLOBAL_KEY = '__XHARE_NAVIGATION_PLUGIN_PROMISE__';

declare global {
  interface Window {
    [GLOBAL_KEY]?: Promise<NavigationPluginNative | null>;
  }
}

/**
 * Obtiene el plugin Navigation solo cuando estamos en plataforma nativa.
 * Usa una promesa global en window para que todos los chunks (RideDetail, settings, etc.)
 * compartan el mismo registro y solo se llame registerPlugin('Navigation') UNA vez por pestaña.
 */
export async function getNavigationPlugin(): Promise<NavigationPluginNative | null> {
  if (typeof window === 'undefined') return null;

  let promise = typeof window !== 'undefined' ? window[GLOBAL_KEY] : undefined;
  if (promise !== undefined) return promise;

  promise = (async (): Promise<NavigationPluginNative | null> => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return null;
      const { registerPlugin } = await import('@capacitor/core');
      const Plugin = registerPlugin<NavigationPluginNative>('Navigation');
      if (!Plugin) return null;
      return Plugin;
    } catch (e) {
      console.error('[NAV] Plugin Navigation no disponible.', e);
      return null;
    }
  })();

  if (typeof window !== 'undefined') window[GLOBAL_KEY] = promise;
  return promise;
}

/** Para tests: limpia la referencia global (no usar en producción). */
export function clearNavigationPluginCache(): void {
  if (typeof window !== 'undefined') delete window[GLOBAL_KEY];
}
