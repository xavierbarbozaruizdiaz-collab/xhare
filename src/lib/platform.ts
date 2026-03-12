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
 * En native no bloquea el flujo si el plugin falla. Android: resultado del plugin se normaliza con unwrapPluginResult.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.geolocation) return true;
  const native = await isNative();
  if (!native) return true;
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

  try {
    const { registerPlugin } = await import('@capacitor/core');
    const Navigation = registerPlugin<{
      getAvailableApps(): Promise<{ value: NavigationAppOption[] } | NavigationAppOption[]>;
    }>('Navigation');

    const result = await Navigation.getAvailableApps();
    const apps = Array.isArray((result as any)?.value) ? (result as any).value : (result as any);

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
    if (dev) console.warn('[NAV_PREF_DEBUG]', { step: 'available_apps_failed', error: String(e) });
    return base;
  }
}

/**
 * Abre navegación hacia (lat, lng) respetando la preferencia del usuario.
 * - En nativo Android: intenta abrir Google Maps o Waze según preferencia.
 * - En web / PWA: abre siempre navegador con Google Maps web.
 */
export async function openNavigation(lat: number, lng: number, _label?: string): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const latVal = Number(lat);
    const lngVal = Number(lng);
    if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) return;
    const dest = `${latVal},${lngVal}`;
    const dev = isDevEnv();

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

    const pref = await getNavigationPreference();
    const apps = await getAvailableNavigationApps();
    if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'preference_loaded', pref, apps });

    const native = await isNative();
    if (!native) {
      openBrowser();
      return;
    }

    const { registerPlugin } = await import('@capacitor/core');
    const Navigation = registerPlugin<{
      openWithChooser(options: { url: string }): Promise<unknown>;
    }>('Navigation');

    const googleAvailable = apps.find((a) => a.id === 'google_maps')?.available;
    const wazeAvailable = apps.find((a) => a.id === 'waze')?.available;

    const openGoogleMaps = async () => {
      if (!googleAvailable) {
        if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'fallback_used', from: 'google_maps', to: 'browser' });
        openBrowser();
        return;
      }
      const uri = `google.navigation:q=${encodeURIComponent(dest)}`;
      if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'opening_google_maps', uri });
      await Navigation.openWithChooser({ url: uri });
    };

    const openWaze = async () => {
      if (!wazeAvailable) {
        if (googleAvailable) {
          if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'fallback_used', from: 'waze', to: 'google_maps' });
          await openGoogleMaps();
          return;
        }
        if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'fallback_used', from: 'waze', to: 'browser' });
        openBrowser();
        return;
      }
      const uri = `waze://?ll=${latVal},${lngVal}&navigate=yes`;
      if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'opening_waze', uri });
      await Navigation.openWithChooser({ url: uri });
    };

    if (pref === 'ask_every_time') {
      if (dev) console.log('[NAV_PREF_DEBUG]', { step: 'ask_every_time', behaviour: 'browser_for_now' });
      openBrowser();
      return;
    }

    if (pref === 'google_maps') {
      await openGoogleMaps();
      return;
    }

    if (pref === 'waze') {
      await openWaze();
      return;
    }

    openBrowser();
  } catch (_) {
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
