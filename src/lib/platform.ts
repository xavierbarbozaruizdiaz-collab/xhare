/**
 * Capa de plataforma solo para navegador (web).
 * La app nativa es Expo en `mobile-app/`; ya no usamos Capacitor en este repo.
 */

export type Position = { lat: number; lng: number };

export type NavigationPreference = 'google_maps' | 'waze' | 'browser' | 'ask_every_time';

export type NavigationAppOption = {
  id: NavigationPreference;
  label: string;
  available: boolean;
};

const NAV_PREF_KEY = 'xhare_navigation_preference';

function isDevEnv() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
}

/** Siempre false: el shell nativo es la app Expo, no la web envuelta. */
export async function isNative(): Promise<boolean> {
  return false;
}

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

export async function requestLocationPermission(): Promise<boolean> {
  return typeof navigator !== 'undefined' && !!navigator?.geolocation;
}

export async function getNavigationPreference(): Promise<NavigationPreference> {
  let raw: string | null = null;
  if (typeof window !== 'undefined' && 'localStorage' in window) {
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
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      window.localStorage.setItem(NAV_PREF_KEY, pref);
    } catch {
      /* ignore */
    }
  }
}

export async function getAvailableNavigationApps(): Promise<NavigationAppOption[]> {
  const base: NavigationAppOption[] = [
    { id: 'google_maps', label: 'Google Maps', available: false },
    { id: 'waze', label: 'Waze', available: false },
    { id: 'browser', label: 'Navegador', available: true },
    { id: 'ask_every_time', label: 'Preguntar cada vez', available: true },
  ];
  if (isDevEnv()) console.log('[NAV_PREF_DEBUG]', { step: 'available_apps_loaded', native: false, apps: base });
  return base;
}

export async function openNavigation(lat: number, lng: number, _label?: string): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const latVal = Number(lat);
    const lngVal = Number(lng);
    if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) return;
    const dest = `${latVal},${lngVal}`;
    const dev = isDevEnv();
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
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[NAV] openNavigation error', e);
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}`;
    if (typeof window !== 'undefined') window.open(mapsUrl, '_blank');
  }
}

export async function requestBatteryPermission(): Promise<void> {
  /* Solo tenía sentido con Capacitor / servicio nativo */
}

export async function onAppStateChange(_callback: (isActive: boolean) => void | Promise<void>): Promise<() => void> {
  return () => {};
}
