/**
 * External navigation: open Maps, Waze, or browser via expo-linking.
 * Sin módulos nativos extra: evita crash si el APK no incluye p. ej. ExpoIntentLauncher.
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

/** URL Waze alineada con la doc oficial: `ll` codificado y `navigate=yes` (+ zoom para fijar destino). */
function wazeNavigateUrls(lat: number, lng: number): string[] {
  const pair = `${lat},${lng}`;
  const https = new URL('https://www.waze.com/ul');
  https.searchParams.set('ll', pair);
  https.searchParams.set('navigate', 'yes');
  https.searchParams.set('zoom', '17');
  const httpsStr = https.toString();
  // Scheme: valor de `ll` codificado para que la coma no la parta otro parser.
  const scheme = `waze://?ll=${encodeURIComponent(pair)}&navigate=yes`;
  return [scheme, httpsStr];
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
  if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return false;
  const via = (options?.via ?? [])
    .map((p) => normalizeLatLng(p.lat, p.lng))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const hasVia = via.length > 0;
  const mapsDirUrl = googleMapsDirectionsUrl(dest.lat, dest.lng, via);

  if (app === 'waze') {
    if (hasVia) {
      return tryOpenUrl(mapsDirUrl);
    }
    const [schemeUrl, httpsUrl] = wazeNavigateUrls(dest.lat, dest.lng);
    for (const url of [schemeUrl, httpsUrl]) {
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
  const u = new URL(WAZE_PREFIX);
  u.searchParams.set('ll', `${dest.lat},${dest.lng}`);
  u.searchParams.set('navigate', 'yes');
  u.searchParams.set('zoom', '17');
  return u.toString();
}
