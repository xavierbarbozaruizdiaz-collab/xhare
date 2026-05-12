/**
 * Navegación externa (Maps / Waze / navegador).
 * Android: módulo nativo `xhare-navigation` usa Intent + setPackage (sin selector "Abrir con").
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { distanceMeters } from '../lib/geo';
import { ANDROID_GOOGLE_MAPS_PKG, ANDROID_WAZE_PKG } from './constants';
import { getXhareNavigationNative } from './navNative';

export { getNavAppAvailability, type NavAppAvailability } from './availability';

export type NavApp = 'google_maps' | 'waze' | 'browser';
export type OpenNavigationError = 'invalid_coordinates' | 'target_app_unavailable';

export type OpenNavigationResult = { ok: true } | { ok: false; error: OpenNavigationError };

const WAZE_PREFIX = 'https://waze.com/ul';

/** Waze rechaza rutas de conducción ~>3000 mi; la recta debe quedar holgada por debajo. */
const WAZE_MAX_HAVERSINE_METERS = 2_500 * 1609.344;

export type NavViaPoint = { lat: number; lng: number };

function normalizeLatLng(lat: number, lng: number): { lat: number; lng: number } {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { lat: a, lng: b };
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

/**
 * Abre URI; en Android el nativo fuerza el paquete. Sin nativo, Linking (puede mostrar selector).
 */
async function tryOpenInPackage(url: string, packageName: string): Promise<OpenNavigationResult> {
  if (Platform.OS !== 'android') {
    return (await tryOpenUrl(url)) ? { ok: true } : { ok: false, error: 'target_app_unavailable' };
  }
  const mod = getXhareNavigationNative();
  if (mod != null) {
    try {
      const opened = await mod.openViewUriInPackage(url, packageName);
      if (opened) return { ok: true };
    } catch {
      /* seguir al fallback */
    }
  }
  if (await tryOpenUrl(url)) return { ok: true };
  return { ok: false, error: 'target_app_unavailable' };
}

function wazeNavigateUrls(lat: number, lng: number): string[] {
  const pair = `${lat},${lng}`;
  const https = new URL('https://www.waze.com/ul');
  https.searchParams.set('ll', pair);
  https.searchParams.set('navigate', 'yes');
  https.searchParams.set('zoom', '17');
  const httpsStr = https.toString();
  const scheme = `waze://?ll=${encodeURIComponent(pair)}&navigate=yes`;
  return [scheme, httpsStr];
}

/**
 * Abre navegación hacia un destino según preferencia guardada en Ajustes.
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
      return await tryOpenInPackage(mapsDirUrl, ANDROID_GOOGLE_MAPS_PKG);
    }
    const [schemeUrl, httpsUrl] = wazeNavigateUrls(dest.lat, dest.lng);
    let r = await tryOpenInPackage(schemeUrl, ANDROID_WAZE_PKG);
    if (r.ok) return r;
    r = await tryOpenInPackage(httpsUrl, ANDROID_WAZE_PKG);
    return r;
  }

  if (effectiveApp === 'browser') {
    const urls = hasVia
      ? [mapsDirUrl, `https://www.google.com/maps?q=${lat},${lng}`]
      : [`https://www.google.com/maps?q=${lat},${lng}`, mapsDirUrl];
    if (Platform.OS === 'android') {
      for (const url of urls) {
        const r = await tryOpenInPackage(url, 'com.android.chrome');
        if (r.ok) return r;
      }
      return { ok: false, error: 'target_app_unavailable' };
    }
    for (const url of urls) {
      if (await tryOpenUrl(url)) return { ok: true };
    }
    return { ok: false, error: 'target_app_unavailable' };
  }

  // google_maps
  if (Platform.OS === 'android' && !hasVia) {
    const navUri = `google.navigation:q=${dest.lat},${dest.lng}`;
    const r = await tryOpenInPackage(navUri, ANDROID_GOOGLE_MAPS_PKG);
    if (r.ok) return r;
  }
  return await tryOpenInPackage(mapsDirUrl, ANDROID_GOOGLE_MAPS_PKG);
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

/** Texto para mostrar en Alert según error de openNavigation (producto público). */
export function openNavigationErrorMessage(
  pref: NavApp,
  error: OpenNavigationError
): { title: string; body: string } {
  if (error === 'invalid_coordinates') {
    return {
      title: 'Navegación',
      body: 'Esta parada no tiene coordenadas válidas.',
    };
  }
  const appLabel =
    pref === 'waze' ? 'Waze' : pref === 'browser' ? 'Google Chrome' : 'Google Maps';
  return {
    title: 'No se pudo abrir la navegación',
    body: `No se pudo abrir ${appLabel} con el destino elegido. Comprobá que esté instalada y actualizada, o elegí otra app en Ajustes > Navegación externa.`,
  };
}
