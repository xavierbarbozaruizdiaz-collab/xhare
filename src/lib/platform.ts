/**
 * Capa de plataforma: único punto de uso de APIs nativas (Capacitor) vs web (navigator, window).
 * La UI solo usa esta capa; así evitamos "Geolocation.then() is not implemented on web" y
 * condicionales dispersos. Ver docs/PLATAFORMA_WEB_VS_NATIVA.md.
 * Resultados de plugins en Android se normalizan con safePluginCall.unwrapPluginResult().
 */

import { unwrapPluginResult } from '@/lib/capacitor/safePluginCall';

export type Position = { lat: number; lng: number };

export type NavigationPreference = 'google_maps' | 'waze' | 'browser' | 'ask_every_time';

export type NavigationAppOption = {
  id: NavigationPreference;
  label: string;
  available: boolean;
};

let cachedNative: boolean | null = null;
const NAV_PREF_KEY = 'xhare_navigation_preference';

function isDevEnv() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
}

/** True solo cuando la app corre en el contenedor nativo (Capacitor), no en navegador. */
export async function isNative(): Promise<boolean> {
  if (cachedNative !== null) return cachedNative;
  if (typeof window === 'undefined') return false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    cachedNative = Capacitor?.isNativePlatform() ?? false;
    return cachedNative;
  } catch {
    cachedNative = false;
    return false;
  }
}

/**
 * Obtiene la posición actual. En web y WebView usa siempre navigator.geolocation.
 * No usa el plugin de Capacitor para evitar errores en contexto web.
 */
export function getCurrentPosition(options?: { timeout?: number; maxAge?: number }): Promise<Position | null> {
  if (typeof window === 'undefined' || !navigator?.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: options?.timeout ?? 10000,
        maximumAge: options?.maxAge ?? 5000,
      }
    );
  });
}

/**
 * Indica si podemos pedir/usar ubicación. En web true si existe navigator.geolocation.
 * En native usa siempre el plugin: comprueba y solo pide si no está concedido (evita repetir el diálogo).
 * Android: resultado del plugin se normaliza con unwrapPluginResult.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const native = await isNative();
  if (!native) {
    return typeof navigator !== 'undefined' && !!navigator?.geolocation;
  }
  const dev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
  try {
    const { getGeolocation } = await import('@/lib/capacitor/rideNative');
    const Geo = await getGeolocation();
    if (!Geo) return true;
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'before_call', method: 'checkPermissions' });
    const perms = await unwrapPluginResult(Geo.checkPermissions(), null as { location?: string } | null);
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'after_call' });
    if (perms?.location === 'granted') return true;
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'before_call', method: 'requestPermissions' });
    const req = await unwrapPluginResult(Geo.requestPermissions(), null as { location?: string } | null);
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'after_call' });
    return req?.location === 'granted';
  } catch (e) {
    if (dev) console.error('[GEO_PLUGIN_DEBUG_ERROR]', e);
    return true;
  }
}

async function getNativePreferences() {
  const native = await isNative();
  if (!native || typeof window === 'undefined') return null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
  } catch {
    return null;
  }
}

export async function getNavigationPreference(): Promise<NavigationPreference> {
  const native = await isNative();
  if (native) {
    const { getNavigationPlugin } = await import('@/lib/capacitor/navigation');
    const plugin = await getNavigationPlugin();
    if (!plugin) {
      const msg = 'Plugin Navigation no disponible. ¿Estás usando el APK de Xhare instalado?';
      console.error('[NAV]', msg);
      throw new Error(msg);
    }
    try {
      const { value } = await plugin.getPreference();
      if (value === 'google_maps' || value === 'waze' || value === 'browser' || value === 'ask_every_time') return value;
    } catch (e) {
      console.error('[NAV] getPreference falló', e);
      throw e;
    }
    return 'ask_every_time';
  }

  let raw: string | null = null;
  const prefs = await getNativePreferences();
  if (prefs) {
    try {
      const { value } = await prefs.get({ key: NAV_PREF_KEY });
      raw = value ?? null;
    } catch {
      raw = null;
    }
  }
  if (!raw && typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      raw = window.localStorage.getItem(NAV_PREF_KEY);
    } catch {
      raw = null;
    }
  }
  const value = raw as NavigationPreference | null;
  if (value === 'google_maps' || value === 'waze' || value === 'browser' || value === 'ask_every_time') {
    return value;
  }
  return 'ask_every_time';
}

export async function setNavigationPreference(pref: NavigationPreference): Promise<void> {
  const native = await isNative();
  if (native) {
    const { getNavigationPlugin } = await import('@/lib/capacitor/navigation');
    const plugin = await getNavigationPlugin();
    if (!plugin) {
      const msg = 'Plugin Navigation no disponible. No se pudo guardar la preferencia.';
      console.error('[NAV]', msg);
      throw new Error(msg);
    }
    await plugin.setPreference({ value: pref });
    return;
  }
  const prefs = await getNativePreferences();
  if (prefs) {
    try {
      await prefs.set({ key: NAV_PREF_KEY, value: pref });
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      window.localStorage.setItem(NAV_PREF_KEY, pref);
    } catch {
      // ignore
    }
  }
}

export async function getAvailableNavigationApps(): Promise<NavigationAppOption[]> {
  const dev = isDevEnv();
  const native = await isNative();
  const base: NavigationAppOption[] = [
    { id: 'google_maps', label: 'Google Maps', available: false },
    { id: 'waze', label: 'Waze', available: false },
    { id: 'browser', label: 'Navegador', available: true },
    { id: 'ask_every_time', label: 'Preguntar cada vez', available: true },
  ];

  if (!native) {
    if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'available_apps_loaded', native: false, apps: base });
    return base;
  }

  const { getNavigationPlugin } = await import('@/lib/capacitor/navigation');
  const plugin = await getNavigationPlugin();
  if (!plugin) {
    if (dev) console.warn('[NAV_PREF_DEBUG]', { step: 'available_apps_plugin_null' });
    return base;
  }

  try {
    const result = await plugin.getAvailableApps();
    const apps = Array.isArray(result?.value) ? result.value : (result as any);

    const byId = new Map<NavigationPreference, NavigationAppOption>();
    base.forEach((opt) => byId.set(opt.id, { ...opt }));

    if (Array.isArray(apps)) {
      for (const item of apps) {
        if (!item?.id) continue;
        const id = item.id as NavigationPreference;
        if (!byId.has(id)) continue;
        const prev = byId.get(id)!;
        byId.set(id, {
          ...prev,
          available: Boolean(item.available),
          label: item.label || prev.label,
        });
      }
    }

    const finalApps = Array.from(byId.values());
    if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'available_apps_loaded', native: true, apps: finalApps });
    return finalApps;
  } catch (e) {
    console.warn('[NAV] getAvailableApps falló', e);
    return base;
  }
}

/**
 * Abre navegación hacia (lat, lng).
 * - Web / PWA: siempre navegador con Google Maps web (sin plugins).
 * - Nativo Android (Capacitor): siempre plugin Navigation.openWithChooser con un intent de navegación.
 */
export async function openNavigation(lat: number, lng: number, _label?: string): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const latVal = Number(lat);
    const lngVal = Number(lng);
    if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) return;
    const dest = `${latVal},${lngVal}`;
    const dev = isDevEnv();
    // Señal visible en Chrome Inspect (consola del WebView): buscar "XHARE_NAV" o filtrar por "NAV"
    console.warn('[XHARE_NAV] openNavigation start', { lat: latVal, lng: lngVal });
    console.log('[NAV] openNavigation start', { lat: latVal, lng: lngVal });

    const openBrowser = () => {
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
      if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'opening_browser', mapsUrl });
      try {
        const a = document.createElement('a');
        a.href = mapsUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch {
        try {
          window.open(mapsUrl, '_blank');
        } catch {
          // ignore
        }
      }
    };

    const native = await isNative();
    if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'native_check', native });

    // Web / PWA: siempre navegador, nunca plugin.
    if (!native) {
      openBrowser();
      return;
    }

    const { getNavigationPlugin } = await import('@/lib/capacitor/navigation');
    const plugin = await getNavigationPlugin();
    if (!plugin) {
      console.error('[NAV] Plugin no disponible; no se puede abrir navegación nativa. ¿Usás el APK instalado?');
      openBrowser();
      return;
    }

    console.log('[NAV] Llamando plugin openNativeNavigation (100% nativo)', { lat: latVal, lng: lngVal });

    try {
      await plugin.openNativeNavigation({ lat: latVal, lng: lngVal });
    } catch (e) {
      console.error('[NAV] openNativeNavigation falló (causa raíz)', e);
      openBrowser();
    }
  } catch (e) {
    console.warn('[NAV] openNavigation error', e);
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}`;
    if (typeof window !== 'undefined') window.open(mapsUrl, '_blank');
  }
}

/** Batería: solo en native. Muestra el diálogo del sistema para permitir ignorar optimización de batería. */
export async function requestBatteryPermission(): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { BackgroundLocation } = await import('@/lib/capacitor/backgroundLocation');
    await BackgroundLocation.requestIgnoreBatteryOptimizations();
  } catch (_) {}
}

/** Listener de cambio de estado de la app (activa/inactiva). Solo en native; en web no hace nada. */
export async function onAppStateChange(callback: (isActive: boolean) => void | Promise<void>): Promise<() => void> {
  if (!(await isNative())) return () => {};
  try {
    const { getApp } = await import('@/lib/capacitor/rideNative');
    const App = await getApp();
    if (!App) return () => {};
    const raw = App.addListener('appStateChange', (e: { isActive: boolean }) => {
      void callback(e.isActive);
    });
    const listenerResult = await unwrapPluginResult(raw, null as { remove?: () => void | Promise<void> } | null);
    const remove = listenerResult?.remove;
    return () => {
      if (typeof remove === 'function') void remove();
    };
  } catch {
    return () => {};
  }
}
