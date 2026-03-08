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
 * En Android el plugin puede devolver el proxy; solo await si el retorno es thenable para evitar "Geolocation.then() is not implemented".
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
    const rawPerms = Geo.checkPermissions();
    let perms: { location?: string } | null = null;
    try {
      const raw = rawPerms;
      const result =
        raw != null && typeof (raw as unknown as { then?: unknown })?.then === 'function'
          ? await (raw as Promise<{ location: string }>)
          : (raw as { location?: string } | null);
      perms = result;
    } catch (e) {
      if (dev) console.error('[GEO_PLUGIN_DEBUG_ERROR]', e);
      const msg = String(e).toLowerCase();
      if (msg.includes('then') && msg.includes('not implemented')) perms = null;
      else throw e;
    }
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'after_call', resultType: typeof rawPerms, hasThen: !!(rawPerms as Promise<unknown>)?.then });
    if (perms?.location === 'granted') return true;
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'before_call', method: 'requestPermissions' });
    const rawReq = Geo.requestPermissions();
    let req: { location?: string } | null = null;
    try {
      const raw = rawReq;
      const result =
        raw != null && typeof (raw as unknown as { then?: unknown })?.then === 'function'
          ? await (raw as Promise<{ location: string }>)
          : (raw as { location?: string } | null);
      req = result;
    } catch (e) {
      if (dev) console.error('[GEO_PLUGIN_DEBUG_ERROR]', e);
      const msg = String(e).toLowerCase();
      if (msg.includes('then') && msg.includes('not implemented')) req = null;
      else throw e;
    }
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'after_call', resultType: typeof rawReq, hasThen: !!(rawReq as Promise<unknown>)?.then });
    return req?.location === 'granted';
  } catch (e) {
    if (dev) console.error('[GEO_PLUGIN_DEBUG_ERROR]', e);
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
  const dev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
  const native = await isNative();
  const timeoutMs = 4000;
  const withTimeout = <T>(p: Promise<T>): Promise<T | 'timeout'> =>
    Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs))]);

  if (native) {
    const geoUrl = `geo:${latVal},${lngVal}${label ? `?q=${encodeURIComponent(label)}` : ''}`;
    if (dev) console.log('[NAV_PLUGIN_DEBUG]', { step: 'before_open', lat: latVal, lng: lngVal, label: label ?? undefined });
    // Solo selector "Abrir con" (Maps, Waze, etc.). En Android el plugin puede devolver el proxy en lugar de una Promise; solo await si es thenable para evitar "Navigation.then() is not implemented".
    try {
      const { getNavigationPlugin } = await import('@/lib/capacitor/navigation');
      const Nav = await getNavigationPlugin();
      if (Nav) {
        const raw = Nav.openWithChooser({ url: geoUrl });
        const isPromise = raw != null && typeof (raw as Promise<void>).then === 'function';
        if (isPromise) {
          const result = await withTimeout(raw as Promise<void>);
          if (dev) console.log('[NAV_PLUGIN_DEBUG]', { step: 'after_open_call', result: result === 'timeout' ? 'timeout' : 'ok' });
          if (result !== 'timeout') {
            if (dev) console.log('[platform.openNavigation] Navigation.openWithChooser ok');
            return;
          }
          if (dev) console.warn('[platform.openNavigation] Navigation timeout, fallback a Browser');
        } else {
          if (dev) console.log('[NAV_PLUGIN_DEBUG]', { step: 'after_open_call', result: 'sync_no_promise' });
          return;
        }
      }
    } catch (e) {
      if (dev) {
        console.error('[NAV_PLUGIN_DEBUG_ERROR]', e);
        console.warn('[platform.openNavigation] Navigation.openWithChooser failed', e);
      }
    }
    // Fallback: abrir URL de Maps en navegador (puede redirigir a app o mostrar opciones)
    try {
      const result = await withTimeout(
        (async () => {
          const { getBrowser } = await import('@/lib/capacitor/rideNative');
          const Browser = await getBrowser();
          if (Browser) {
            if (dev) console.log('[platform.openNavigation] fallback Browser.open', fallbackUrl);
            await Browser.open({ url: fallbackUrl });
          }
        })()
      );
      if (result !== 'timeout') return;
    } catch (e) {
      if (dev) console.warn('[platform.openNavigation] Browser.open failed', e);
    }
  }
  if (dev) console.log('[platform.openNavigation] using window.open', fallbackUrl);
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

/** Batería: solo en native. Muestra el diálogo del sistema para permitir ignorar optimización de batería. */
export async function requestBatteryPermission(): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { BackgroundLocation } = await import('@/lib/capacitor/backgroundLocation');
    await BackgroundLocation.requestIgnoreBatteryOptimizations();
  } catch (_) {}
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
    // En Android addListener puede devolver el proxy en lugar de Promise; solo await si es thenable para evitar "App.then() is not implemented".
    const raw = App.addListener('appStateChange', (e: { isActive: boolean }) => {
      void callback(e.isActive);
    });
    const listenerResult =
      raw != null && typeof (raw as Promise<{ remove: () => void | Promise<void> }>).then === 'function'
        ? await (raw as Promise<{ remove: () => void | Promise<void> }>)
        : (raw as { remove?: () => void | Promise<void> } | null);
    const remove = listenerResult?.remove;
    return () => {
      if (typeof remove === 'function') void remove();
    };
  } catch {
    return () => {};
  }
}
