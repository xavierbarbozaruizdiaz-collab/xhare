/**
 * External navigation: open Maps, Waze, or browser.
 * First-class citizen: no custom native plugins; use expo-linking.
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export type NavApp = 'google_maps' | 'waze' | 'browser';

const WAZE_PREFIX = 'https://waze.com/ul';

export type NavViaPoint = { lat: number; lng: number };

function normalizeLatLng(lat: number, lng: number): { lat: number; lng: number } {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { lat: a, lng: b };
  // Heurística: si lat queda fuera de rango típico y lng no, asumimos swap.
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) return { lat: b, lng: a };
  return { lat: a, lng: b };
}

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

async function tryOpenSchemeUrl(url: string): Promise<boolean> {
  try {
    const can = await Linking.canOpenURL(url);
    if (!can) return false;
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
  const dest = normalizeLatLng(lat, lng);
  const via = (options?.via ?? [])
    .map((p) => normalizeLatLng(p.lat, p.lng))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const hasVia = via.length > 0;
  const mapsDirUrl = googleMapsDirectionsUrl(dest.lat, dest.lng, via);

  if (app === 'waze') {
    if (hasVia) {
      return tryOpenUrl(mapsDirUrl);
    }
    // En Android/iOS preferimos el scheme para evitar el diálogo "Abrir con".
    const schemeUrl = `waze://?ll=${dest.lat},${dest.lng}&navigate=yes`;
    if (await tryOpenSchemeUrl(schemeUrl)) return true;
    const httpsUrl =
      Platform.OS === 'android'
        ? `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`
        : `https://www.waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`;
    return tryOpenUrl(httpsUrl);
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
    // `google.navigation:` abre directo en Google Maps si está instalado.
    urls.push(`google.navigation:q=${dest.lat},${dest.lng}`);
  }
  urls.push(mapsDirUrl);
  for (const url of urls) {
    if (await tryOpenUrl(url)) return true;
  }
  return false;
}

export function getGoogleMapsUrl(lat: number, lng: number, via: NavViaPoint[] = []): string {
  const dest = normalizeLatLng(lat, lng);
  const cleanVia = via.map((p) => normalizeLatLng(p.lat, p.lng));
  return googleMapsDirectionsUrl(dest.lat, dest.lng, cleanVia);
}

export function getWazeUrl(lat: number, lng: number): string {
  const dest = normalizeLatLng(lat, lng);
  return `${WAZE_PREFIX}?ll=${dest.lat},${dest.lng}&navigate=yes`;
}
