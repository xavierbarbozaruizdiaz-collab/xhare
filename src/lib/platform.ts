/**
 * Capa de plataforma: único punto de uso de APIs nativas (Capacitor) vs web (navigator, window).
 * La UI solo usa esta capa; así evitamos "Geolocation.then() is not implemented on web" y
 * condicionales dispersos. Ver docs/PLATAFORMA_WEB_VS_NATIVA.md.
 */

export type Position = { lat: number; lng: number };

let cachedNative: boolean | null = null;

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
 * En native no bloquea el flujo si el plugin falla.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.geolocation) return true;
  const native = await isNative();
  if (!native) return true;
  try {
    const { getGeolocation } = await import('@/lib/capacitor/rideNative');
    const Geo = await getGeolocation();
    if (!Geo) return true;
    const perms = await Geo.checkPermissions();
    if (perms.location === 'granted') return true;
    const req = await Geo.requestPermissions();
    return req.location === 'granted';
  } catch {
    return true;
  }
}

/**
 * Abre navegación hacia (lat, lng). En native intenta geo: (selector de apps), luego Browser, luego window.open.
 * En web usa window.open con URL de Google Maps.
 */
export async function openNavigation(lat: number, lng: number, label?: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const latVal = Number(lat);
  const lngVal = Number(lng);
  if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) return;
  const dest = `${latVal},${lngVal}`;
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  const native = await isNative();
  if (native) {
    try {
      const { getAppLauncher } = await import('@/lib/capacitor/rideNative');
      const AppLaunch = await getAppLauncher();
      if (AppLaunch) {
        const geoLabel = label ? encodeURIComponent(label) : dest;
        await AppLaunch.openUrl({ url: `geo:${latVal},${lngVal}?q=${geoLabel}` });
        return;
      }
    } catch (_) {}
    try {
      const { getBrowser } = await import('@/lib/capacitor/rideNative');
      const Browser = await getBrowser();
      if (Browser) {
        await Browser.open({ url: fallbackUrl });
        return;
      }
    } catch (_) {}
  }
  window.open(fallbackUrl, '_blank');
}

/** Overlay (burbuja): solo en native. Solicita permiso. */
export async function requestOverlayPermission(): Promise<boolean> {
  if (!(await isNative())) return false;
  try {
    const { BubbleOverlay } = await import('@/lib/capacitor/bubbleOverlay');
    const { granted } = await BubbleOverlay.hasOverlayPermission();
    if (granted) return true;
    const { granted: after } = await BubbleOverlay.requestOverlayPermission();
    return after;
  } catch {
    return false;
  }
}

/** Muestra la burbuja flotante (solo native). */
export async function showBubble(label?: string): Promise<boolean> {
  if (!(await isNative())) return false;
  try {
    const { BubbleOverlay } = await import('@/lib/capacitor/bubbleOverlay');
    const { shown } = await BubbleOverlay.showBubble({ label });
    return shown;
  } catch {
    return false;
  }
}

/** Oculta la burbuja (solo native, no-op en web). */
export async function hideBubble(): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { BubbleOverlay } = await import('@/lib/capacitor/bubbleOverlay');
    await BubbleOverlay.hideBubble();
  } catch (_) {}
}

/** Listener de cambio de estado de la app (activa/inactiva). Solo en native; en web no hace nada. */
export async function onAppStateChange(callback: (isActive: boolean) => void | Promise<void>): Promise<() => void> {
  if (!(await isNative())) return () => {};
  try {
    const { getApp } = await import('@/lib/capacitor/rideNative');
    const App = await getApp();
    if (!App) return () => {};
    const { remove } = await App.addListener('appStateChange', (e: { isActive: boolean }) => {
      void callback(e.isActive);
    });
    return () => {
      void remove();
    };
  } catch {
    return () => {};
  }
}
