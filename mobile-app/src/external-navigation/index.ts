/**
 * External navigation: open Maps, Waze, or browser.
 * First-class citizen: no custom native plugins; use expo-linking.
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export type NavApp = 'google_maps' | 'waze' | 'browser';

const GOOGLE_MAPS_PREFIX = 'https://www.google.com/maps/dir/?api=1';
const WAZE_PREFIX = 'https://waze.com/ul';

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
 * Waze: no hacemos fallback silencioso a Google Maps si el usuario eligió Waze (evita “parece bug”).
 */
export async function openNavigation(lat: number, lng: number, app: NavApp = 'google_maps'): Promise<boolean> {
  const destination = `${lat},${lng}`;
  const mapsHttpsUrl = `${GOOGLE_MAPS_PREFIX}&destination=${destination}`;

  if (app === 'waze') {
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
    const urls = [`https://www.google.com/maps?q=${lat},${lng}`, mapsHttpsUrl];
    for (const url of urls) {
      if (await tryOpenUrl(url)) return true;
    }
    return false;
  }

  // google_maps
  const urls: string[] = [];
  if (Platform.OS === 'android') {
    urls.push(`google.navigation:q=${lat},${lng}`);
  }
  urls.push(mapsHttpsUrl);
  for (const url of urls) {
    if (await tryOpenUrl(url)) return true;
  }
  return false;
}

export function getGoogleMapsUrl(lat: number, lng: number): string {
  return `${GOOGLE_MAPS_PREFIX}&destination=${lat},${lng}`;
}

export function getWazeUrl(lat: number, lng: number): string {
  return `${WAZE_PREFIX}&ll=${lat},${lng}&navigate=yes`;
}
