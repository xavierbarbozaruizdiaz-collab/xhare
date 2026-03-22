/**
 * External navigation: open Maps, Waze, or browser.
 * First-class citizen: no custom native plugins; use expo-linking.
 */
import * as Linking from 'expo-linking';

export type NavApp = 'google_maps' | 'waze' | 'browser';

const GOOGLE_MAPS_PREFIX = 'https://www.google.com/maps/dir/?api=1';
const WAZE_PREFIX = 'https://waze.com/ul';

/**
 * Open navigation to a destination. Prefer user preference (store in settings).
 * No se usa canOpenURL como puerta: en Android/iOS puede devolver false para URLs
 * válidas; se intenta openURL directamente (recomendado por Expo/React Native).
 */
export async function openNavigation(lat: number, lng: number, app: NavApp = 'google_maps'): Promise<boolean> {
  const destination = `${lat},${lng}`;
  const mapsUrl = `${GOOGLE_MAPS_PREFIX}&destination=${destination}`;
  const urlsToTry: string[] = [];
  switch (app) {
    case 'waze':
      urlsToTry.push(`waze://?ll=${lat},${lng}&navigate=yes`, `https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes`, mapsUrl);
      break;
    case 'browser':
      urlsToTry.push(`https://www.google.com/maps?q=${lat},${lng}`, mapsUrl);
      break;
    default:
      urlsToTry.push(mapsUrl);
  }
  for (const url of urlsToTry) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Siguiente URL
    }
  }
  return false;
}

export function getGoogleMapsUrl(lat: number, lng: number): string {
  return `${GOOGLE_MAPS_PREFIX}&destination=${lat},${lng}`;
}

export function getWazeUrl(lat: number, lng: number): string {
  return `${WAZE_PREFIX}&ll=${lat},${lng}&navigate=yes`;
}
