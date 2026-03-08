/**
 * Capa centralizada de permisos para la app móvil (Next.js + Capacitor Android).
 * Delega en platform.ts y plugins; no duplica lógica nativa.
 * Ver docs/AUDITORIA_PERMISOS_APP.md.
 * Resultados de plugins en Android se normalizan con safePluginCall.unwrapPluginResult().
 */

import { unwrapPluginResult } from '@/lib/capacitor/safePluginCall';

export type LocationPermissionStatus = 'granted' | 'denied' | 'prompt';
export type NotificationPermissionStatus = 'granted' | 'denied' | 'default';

/** Flujos que usan cada permiso (para documentación y ensurePermissionForAction) */
export const PERMISSION_FLOWS = {
  location: 'Búsqueda/publicar: "Usar mi ubicación"; detalle viaje: enviar posición; navegación',
  background_location: 'Conductor: tracking en segundo plano durante viaje en curso',
  overlay: 'Conductor: burbuja flotante cuando el viaje está en curso',
  battery: 'Conductor: evitar que el sistema mate el tracking en segundo plano',
  notifications: 'Push: avisos de viajes; web: notificación "Viaje en curso"',
} as const;

/**
 * Comprueba el estado del permiso de ubicación (sin pedirlo).
 * En web devuelve 'granted' si existe navigator.geolocation.
 */
export async function checkLocationPermission(): Promise<LocationPermissionStatus> {
  if (typeof window === 'undefined') return 'prompt';
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const platform = await import('@/lib/platform');
    if (!(await platform.isNative())) return 'granted';
  }
  try {
    const { getGeolocation } = await import('@/lib/capacitor/rideNative');
    const Geo = await getGeolocation();
    if (!Geo) return 'prompt';
    const dev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'before_call', method: 'checkPermissions' });
    const perms = await unwrapPluginResult(Geo.checkPermissions(), null as { location?: string } | null);
    if (dev) console.log('[GEO_PLUGIN_DEBUG]', { step: 'after_call' });
    const status = perms?.location ?? 'prompt';
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'prompt';
  } catch (e) {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') console.error('[GEO_PLUGIN_DEBUG_ERROR]', e);
    return 'prompt';
  }
}

/**
 * Pide permiso de ubicación. En web no hace nada (true).
 * Flujo: tras login (native) o antes de usar mapa/tracking.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const platform = await import('@/lib/platform');
  return platform.requestLocationPermission();
}

/**
 * Asegura permiso de ubicación: comprueba y si no está concedido, pide.
 * No muestra mensaje propio; el caller puede mostrarlo antes.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  const status = await checkLocationPermission();
  if (status === 'granted') return true;
  return requestLocationPermission();
}

/**
 * Comprueba si ya tiene permiso de overlay (sobre otras apps).
 * Solo relevante en native.
 */
export async function checkOverlayPermission(): Promise<boolean> {
  const platform = await import('@/lib/platform');
  if (!(await platform.isNative())) return false;
  try {
    const { BubbleOverlay } = await import('@/lib/capacitor/bubbleOverlay');
    const { granted } = await BubbleOverlay.hasOverlayPermission();
    return granted;
  } catch {
    return false;
  }
}

/**
 * Pide permiso de overlay (burbuja).
 * Flujo: tras login (native) o al configurar burbuja en viaje en curso.
 */
export async function requestOverlayPermission(): Promise<boolean> {
  const platform = await import('@/lib/platform');
  return platform.requestOverlayPermission();
}

/**
 * Asegura permiso de overlay: check y si no, request.
 */
export async function ensureOverlayPermission(): Promise<boolean> {
  if (await checkOverlayPermission()) return true;
  return requestOverlayPermission();
}

/**
 * Pide al sistema que permita ignorar optimización de batería (solo native).
 * Flujo: tras login (native).
 */
export async function requestBatteryOptimization(): Promise<void> {
  const platform = await import('@/lib/platform');
  return platform.requestBatteryPermission();
}

/**
 * Estado del permiso de notificaciones (web API).
 */
export async function checkNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return (Notification.permission as NotificationPermissionStatus) ?? 'default';
}

/**
 * Pide permiso de notificaciones (web). Para push en native se usa registerForPush().
 * Flujo: al pasar viaje a en_route (web) o al registrar push (native).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Asegura permiso para una acción; útil para centralizar "qué pedir" por flujo.
 * No cambia el momento en que se pide; el caller decide cuándo llamar.
 */
export async function ensurePermissionForAction(
  action: keyof typeof PERMISSION_FLOWS
): Promise<boolean> {
  switch (action) {
    case 'location':
    case 'background_location':
      return ensureLocationPermission();
    case 'overlay':
      return ensureOverlayPermission();
    case 'battery':
      await requestBatteryOptimization();
      return true;
    case 'notifications':
      return requestNotificationPermission();
    default:
      return false;
  }
}
