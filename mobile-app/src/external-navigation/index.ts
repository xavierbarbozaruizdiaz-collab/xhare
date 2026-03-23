/**
 * External navigation: open Maps, Waze, or browser.
 * First-class citizen: no custom native plugins; use expo-linking.
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export type NavApp = 'google_maps' | 'waze' | 'browser';

const WAZE_PREFIX = 'https://waze.com/ul';

export type NavViaPoint = { lat: number; lng: number };

function googleMapsDirectionsUrl(destLat: number, destLng: number, via: NavViaPoint[]): string {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${destLat},${destLng}`);
  const clean = via.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (clean.length > 0) {
    u.searchParams.set('waypoints', clean.map((w) => `${w.lat},${w.lng}`).join('|'));
  }
  return u.toString();
}

async function tryOpenUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open navigation to a destination. Uses saved preference from settings (caller should pass it).
 * `via`: paradas intermedias (p. ej. subidas/bajadas de pasajeros). Solo Google Maps soporta varias en un enlace;
 * con Waze y `via` no vacío se abre Google Maps con waypoints (Waze no tiene el mismo contrato multi-parada).
 */
export async function openNavigation(
  lat: number,
  lng: number,
  app: NavApp = 'google_maps',
  options?: { via?: NavViaPoint[] }
): Promise<boolean> {
  const via = (options?.via ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const hasVia = via.length > 0;
  const mapsDirUrl = googleMapsDirectionsUrl(lat, lng, via);

  if (app === 'waze') {
    if (hasVia) {
      return tryOpenUrl(mapsDirUrl);
    }
    const wazeUrls =
      Platform.OS === 'android'
        ? [`waze://?ll=${lat},${lng}&navigate=yes`, `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`]
        : [`waze://?ll=${lat},${lng}&navigate=yes`, `https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes`];
    for (const url of wazeUrls) {
      if (await tryOpenUrl(url)) return true;
    }
    return false;
  }

  if (app === 'browser') {
    const urls = hasVia
      ? [mapsDirUrl, `https://www.google.com/maps?q=${lat},${lng}`]
      : [`https://www.google.com/maps?q=${lat},${lng}`, mapsDirUrl];
    for (const url of urls) {
      if (await tryOpenUrl(url)) return true;
    }
    return false;
  }

  // google_maps
  const urls: string[] = [];
  if (Platform.OS === 'android' && !hasVia) {
    urls.push(`google.navigation:q=${lat},${lng}`);
  }
  urls.push(mapsDirUrl);
  for (const url of urls) {
    if (await tryOpenUrl(url)) return true;
  }
  return false;
}

export function getGoogleMapsUrl(lat: number, lng: number, via: NavViaPoint[] = []): string {
  return googleMapsDirectionsUrl(lat, lng, via);
}

export function getWazeUrl(lat: number, lng: number): string {
  return `${WAZE_PREFIX}&ll=${lat},${lng}&navigate=yes`;
}
