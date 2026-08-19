/**
 * Ajuste a calle más cercana sin depender del deploy de Next.
 * Usa OSRM nearest (driving). Si el backend `/api/route/snap-to-road` está disponible, se prueba primero.
 */
import { env } from '../core/env';

export type SnapToRoadResult = {
  lat: number;
  lng: number;
  distanceMeters?: number;
  source?: string;
  error?: string;
  code?: string;
};

const SNAP_MAX_METERS = 100;
const SNAP_TIMEOUT_MS = 10_000;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SNAP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

async function snapWithOsrm(lat: number, lng: number): Promise<SnapToRoadResult | null> {
  const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
  const { ok, data } = await fetchJson(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!ok || data.code !== 'Ok') return null;
  const waypoints = data.waypoints as Array<{ location?: [number, number]; distance?: number }> | undefined;
  const wp = waypoints?.[0];
  const loc = wp?.location;
  if (!loc || loc.length < 2) return null;
  const snapped = { lat: loc[1], lng: loc[0] };
  const distanceMeters =
    typeof wp.distance === 'number' && Number.isFinite(wp.distance)
      ? wp.distance
      : haversineMeters({ lat, lng }, snapped);
  if (distanceMeters > SNAP_MAX_METERS) {
    return {
      lat,
      lng,
      distanceMeters,
      error: 'No hay una calle cerca. Centrá el mapa sobre una vía.',
      code: 'not_on_road',
    };
  }
  return { ...snapped, distanceMeters, source: 'osrm' };
}

async function snapWithBackend(lat: number, lng: number): Promise<SnapToRoadResult | null> {
  const base = env.apiBaseUrl?.trim().replace(/\/$/, '');
  if (!base) return null;
  try {
    const { ok, status, data } = await fetchJson(`${base}/api/route/snap-to-road`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    if (status === 404) return null; // endpoint aún no deployado
    if (status === 422 || data.code === 'not_on_road') {
      return {
        lat,
        lng,
        error:
          typeof data.error === 'string'
            ? data.error
            : 'No hay una calle cerca. Centrá el mapa sobre una vía.',
        code: 'not_on_road',
      };
    }
    if (!ok) return null;
    const outLat = typeof data.lat === 'number' ? data.lat : Number(data.lat);
    const outLng = typeof data.lng === 'number' ? data.lng : Number(data.lng);
    if (!Number.isFinite(outLat) || !Number.isFinite(outLng)) return null;
    return {
      lat: outLat,
      lng: outLng,
      distanceMeters: typeof data.distanceMeters === 'number' ? data.distanceMeters : undefined,
      source: typeof data.source === 'string' ? data.source : 'api',
    };
  } catch {
    return null;
  }
}

/**
 * Ajusta a la calle más cercana. Backend si existe; si no, OSRM directo desde el dispositivo.
 */
export async function snapToNearestRoad(lat: number, lng: number): Promise<SnapToRoadResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { lat, lng, error: 'Punto inválido', code: 'bad_request' };
  }

  const fromApi = await snapWithBackend(lat, lng);
  if (fromApi && !fromApi.error) return fromApi;
  if (fromApi?.code === 'not_on_road') {
    // Backend dijo que no hay calle: no insistir con otro proveedor salvo OSRM por si el backend falló por Google.
    // Igual probamos OSRM por si Roads API no está habilitada en el deploy.
  }

  try {
    const fromOsrm = await snapWithOsrm(lat, lng);
    if (fromOsrm) return fromOsrm;
  } catch {
    // continue
  }

  if (fromApi?.error) return fromApi;
  return {
    lat,
    lng,
    error: 'No se pudo ajustar a la calle. Revisá la conexión e intentá de nuevo.',
    code: 'snap_error',
  };
}
