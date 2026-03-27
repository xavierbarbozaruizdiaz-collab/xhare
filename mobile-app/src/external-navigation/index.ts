/**
 * External navigation: open Maps, Waze, or browser.
 * Android: usa intent explícito por package cuando existe para evitar el popup "Abrir con".
 */
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { distanceMeters } from '../lib/geo';

export type NavApp = 'google_maps' | 'waze' | 'browser';
export type OpenNavigationError = 'invalid_coordinates' | 'target_app_unavailable';
export type OpenNavigationResult = { ok: true } | { ok: false; error: OpenNavigationError };

const WAZE_PREFIX = 'https://waze.com/ul';
const ANDROID_GOOGLE_MAPS_PKG = 'com.google.android.apps.maps';
const ANDROID_WAZE_PKG = 'com.waze';

/** Waze rechaza rutas de conducción ~>3000 mi; la recta debe quedar holgada por debajo (emulador en US + destino en PY dispara 402). */
const WAZE_MAX_HAVERSINE_METERS = 2_500 * 1609.344;

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

async function tryOpenInPackage(url: string, packageName: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: url,
      packageName,
    });
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
 * `via`: waypoints intermedios solo para Google Maps (URLs `dir`). Mantener **pocos** (p. ej. una pierna del viaje);
 * listas largas provocan rechazos (p. ej. Waze 402) y conviene abrir **solo el destino del tramo** con `via: []`
 * y origen implícito en el GPS del dispositivo.
 * Con Waze y `via` no vacío se abre Google Maps con waypoints (Waze no expone el mismo contrato multi-parada).
 * `origin`: ubicación actual (GPS). Si la elegida es Waze y la distancia a destino supera el tope de Waze,
 * se abre Google Maps automáticamente (p. ej. emulador con Mountain View y parada en otro país).
 */
export async function openNavigation(
  lat: number,
  lng: number,
  app: NavApp = 'google_maps',
  options?: { via?: NavViaPoint[]; origin?: NavViaPoint }
): Promise<OpenNavigationResult> {
  const dest = normalizeLatLng(lat, lng);
  if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) {
    return { ok: false, error: 'invalid_coordinates' };
  }
  const via = (options?.via ?? [])
    .map((p) => normalizeLatLng(p.lat, p.lng))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const hasVia = via.length > 0;
  const mapsDirUrl = googleMapsDirectionsUrl(dest.lat, dest.lng, via);

  let effectiveApp: NavApp = app;
  if (app === 'waze' && !hasVia && options?.origin) {
    const o = normalizeLatLng(options.origin.lat, options.origin.lng);
    if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
      const d = distanceMeters({ lat: o.lat, lng: o.lng }, { lat: dest.lat, lng: dest.lng });
      if (d > WAZE_MAX_HAVERSINE_METERS) effectiveApp = 'google_maps';
    }
  }

  if (effectiveApp === 'waze') {
    if (hasVia) {
      if (await tryOpenInPackage(mapsDirUrl, ANDROID_GOOGLE_MAPS_PKG)) return { ok: true };
      if (Platform.OS === 'android') return { ok: false, error: 'target_app_unavailable' };
      return (await tryOpenUrl(mapsDirUrl)) ? { ok: true } : { ok: false, error: 'target_app_unavailable' };
    }
    const [schemeUrl, httpsUrl] = wazeNavigateUrls(dest.lat, dest.lng);
    if (await tryOpenInPackage(schemeUrl, ANDROID_WAZE_PKG)) return { ok: true };
    if (await tryOpenInPackage(httpsUrl, ANDROID_WAZE_PKG)) return { ok: true };
    if (Platform.OS === 'android') return { ok: false, error: 'target_app_unavailable' };
    for (const url of [schemeUrl, httpsUrl]) {
      if (await tryOpenUrl(url)) return { ok: true };
    }
    return { ok: false, error: 'target_app_unavailable' };
  }

  if (effectiveApp === 'browser') {
    const urls = hasVia
      ? [mapsDirUrl, `https://www.google.com/maps?q=${lat},${lng}`]
      : [`https://www.google.com/maps?q=${lat},${lng}`, mapsDirUrl];
    if (Platform.OS === 'android') {
      // Evita el chooser "Abrir con..." forzando navegador explícito.
      // Si Chrome no está instalado, devolvemos false para que el caller avise.
      for (const url of urls) {
        if (await tryOpenInPackage(url, 'com.android.chrome')) return { ok: true };
      }
      return { ok: false, error: 'target_app_unavailable' };
    }
    for (const url of urls) {
      if (await tryOpenUrl(url)) return { ok: true };
    }
    return { ok: false, error: 'target_app_unavailable' };
  }

  // google_maps
  const urls: string[] = [];
  if (Platform.OS === 'android' && !hasVia) {
    if (await tryOpenInPackage(`google.navigation:q=${dest.lat},${dest.lng}`, ANDROID_GOOGLE_MAPS_PKG)) {
      return { ok: true };
    }
    urls.push(`google.navigation:q=${dest.lat},${dest.lng}`);
  }
  if (await tryOpenInPackage(mapsDirUrl, ANDROID_GOOGLE_MAPS_PKG)) return { ok: true };
  urls.push(mapsDirUrl);
  if (Platform.OS === 'android') return { ok: false, error: 'target_app_unavailable' };
  for (const url of urls) {
    if (await tryOpenUrl(url)) return { ok: true };
  }
  return { ok: false, error: 'target_app_unavailable' };
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
