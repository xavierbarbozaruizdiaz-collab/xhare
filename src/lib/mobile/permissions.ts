/**
 * Permisos para la web (navegador). La app nativa (Expo) gestiona permisos en `mobile-app/`.
 */

export type LocationPermissionStatus = 'granted' | 'denied' | 'prompt';
export type NotificationPermissionStatus = 'granted' | 'denied' | 'default';

export const PERMISSION_FLOWS = {
  location: 'Búsqueda/publicar: "Usar mi ubicación"; detalle viaje: enviar posición; navegación',
  background_location: 'No aplica en web; en app Expo el conductor usa tracking nativo',
  battery: 'No aplica en web',
  notifications: 'Notificaciones del navegador cuando están permitidas',
} as const;

export async function checkLocationPermission(): Promise<LocationPermissionStatus> {
  if (typeof window === 'undefined') return 'prompt';
  try {
    if (navigator.permissions?.query) {
      const r = await navigator.permissions.query({ name: 'geolocation' });
      if (r.state === 'granted') return 'granted';
      if (r.state === 'denied') return 'denied';
      return 'prompt';
    }
  } catch {
    /* Permissions API no disponible o nombre no soportado */
  }
  return typeof navigator !== 'undefined' && navigator.geolocation ? 'prompt' : 'denied';
}

export async function requestLocationPermission(): Promise<boolean> {
  const { requestLocationPermission: req } = await import('@/lib/platform');
  return req();
}

export async function ensureLocationPermission(): Promise<boolean> {
  const status = await checkLocationPermission();
  if (status === 'granted') return true;
  return requestLocationPermission();
}

export async function requestBatteryOptimization(): Promise<void> {
  /* No-op en web */
}

export async function checkNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return (Notification.permission as NotificationPermissionStatus) ?? 'default';
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export async function ensurePermissionForAction(
  action: keyof typeof PERMISSION_FLOWS
): Promise<boolean> {
  switch (action) {
    case 'location':
    case 'background_location':
      return ensureLocationPermission();
    case 'battery':
      await requestBatteryOptimization();
      return true;
    case 'notifications':
      return requestNotificationPermission();
    default:
      return false;
  }
}
