/**
 * Route polyline y duración: POST al backend Next.js `/api/route/polyline` (Google Routes en servidor).
 * Usado en: publicar viaje, mapas de búsqueda, reservas, etc.
 *
 * Interno: timeout, AbortSignal, dedupe en vuelo, caché corta en cliente para respuestas OK.
 */
import { env } from '../core/env';

type Point = { lat: number; lng: number };

/** Evita `fetch` colgado sin respuesta (deja spinners infinitos en la app). */
const ROUTE_API_FETCH_TIMEOUT_MS = 18_000;
/**
 * POST /api/route/polyline: el timeout del cliente debe ser mayor que el del servidor (Google Routes + cadena de tramos)
 * más margen de red; si no, el fetch aborta aunque el backend devuelva fallback o ruta OK un poco después.
 */
const POLYLINE_FETCH_TIMEOUT_MS = 30_000;

/** Reutilizar respuestas recientes idénticas (misma UX; menos red). */
const ROUTE_CLIENT_CACHE_TTL_MS = 2500;
const ROUTE_CLIENT_CACHE_MAX_ENTRIES = 48;

function getApiBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

function roundCoord(n: number): string {
  return `${Math.round(n * 1e5) / 1e5}`;
}

function pointKey(p: Point): string {
  return `${roundCoord(p.lat)},${roundCoord(p.lng)}`;
}

/** Clave estable para misma petición lógica (waypoints en orden recibido). */
export function routePolylineRequestKey(origin: Point, destination: Point, waypoints: Point[] = []): string {
  const w = waypoints.map(pointKey).join('|');
  return `poly|${pointKey(origin)}|${w ? `${w}|` : ''}${pointKey(destination)}`;
}

function segmentStatsRequestKey(origin: Point, destination: Point, waypoints: Point[]): string {
  const w = waypoints.map(pointKey).join('|');
  return `seg|${pointKey(origin)}|${w ? `${w}|` : ''}${pointKey(destination)}`;
}

function pruneOldCacheEntries<K>(map: Map<K, { expiresAt: number }>, maxEntries: number) {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.expiresAt <= now) map.delete(k);
  }
  while (map.size > maxEntries) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/** Métricas mínimas en __DEV__ (quitar o desactivar revisando esta constante). */
const ROUTE_API_DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;

const routeDebug = {
  polyFetch: 0,
  polyCacheHit: 0,
  polyInflightHit: 0,
  polyAborted: 0,
  segFetch: 0,
  segCacheHit: 0,
  segInflightHit: 0,
  segAborted: 0,
};

/** Solo pruebas / diagnóstico en desarrollo. */
export function getRouteApiDebugSnapshot() {
  return { ...routeDebug };
}

export type RouteFetchOptions = {
  /** Si se pasa, no se comparte la promesa en vuelo con otras llamadas (evita cancelar a terceros). */
  signal?: AbortSignal;
};

export type RouteResult = {
  polyline?: Array<{ lat: number; lng: number }>;
  durationMinutes?: number;
  distanceKm?: number;
  fallback?: boolean;
  fallbackReason?: string;
  error?: string;
  /** true si el caller abortó (no es timeout de red). */
  aborted?: boolean;
};

export type SegmentStatsResult = {
  distanceKm?: number;
  durationMinutes?: number;
  error?: string;
  aborted?: boolean;
};

type CachedRoute = { expiresAt: number; result: RouteResult };
const routeResultCache = new Map<string, CachedRoute>();
const routeInflight = new Map<string, Promise<RouteResult>>();

type CachedSeg = { expiresAt: number; result: SegmentStatsResult };
const segmentResultCache = new Map<string, CachedSeg>();
const segmentInflight = new Map<string, Promise<SegmentStatsResult>>();

function cloneRouteResult(r: RouteResult): RouteResult {
  return {
    ...r,
    polyline: r.polyline ? r.polyline.map((p) => ({ lat: p.lat, lng: p.lng })) : undefined,
  };
}

function cloneSegmentResult(r: SegmentStatsResult): SegmentStatsResult {
  return { ...r };
}

async function fetchWithTimeoutAndSignal(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  const master = new AbortController();
  const t = setTimeout(() => master.abort(), timeoutMs);
  const onExternal = () => {
    clearTimeout(t);
    master.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(t);
      master.abort();
    } else {
      externalSignal.addEventListener('abort', onExternal, { once: true });
    }
  }
  try {
    return await fetch(url, { ...init, signal: master.signal });
  } finally {
    clearTimeout(t);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternal);
  }
}

async function executePolylineFetch(
  url: string,
  body: object,
  externalSignal?: AbortSignal
): Promise<RouteResult> {
  if (ROUTE_API_DEBUG) {
    console.log('[routeApi] POST (effective URL):', url);
  }
  try {
    const res = await fetchWithTimeoutAndSignal(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      POLYLINE_FETCH_TIMEOUT_MS,
      externalSignal
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (ROUTE_API_DEBUG) {
        console.warn('[routeApi] polyline HTTP error', res.status, (data as { error?: string }).error);
      }
      return { error: (data as { error?: string }).error ?? 'Error al obtener la ruta' };
    }
    const result: RouteResult = {
      polyline: Array.isArray((data as { polyline?: unknown }).polyline)
        ? (data as { polyline: Array<{ lat: number; lng: number }> }).polyline
        : undefined,
      durationMinutes: (data as { durationMinutes?: number }).durationMinutes,
      distanceKm: (data as { distanceKm?: number }).distanceKm,
      fallback: Boolean((data as { fallback?: unknown }).fallback),
      fallbackReason:
        typeof (data as { fallbackReason?: unknown }).fallbackReason === 'string'
          ? (data as { fallbackReason: string }).fallbackReason
          : undefined,
    };
    if (ROUTE_API_DEBUG) {
      const n = result.polyline?.length ?? 0;
      if (result.fallback) {
        console.warn(
          '[routeApi] polyline response FALLBACK',
          result.fallbackReason ?? '(sin razón)',
          'points:',
          n
        );
      } else {
        console.log('[routeApi] polyline response OK', {
          points: n,
          fallback: false,
          distanceKm: result.distanceKm,
          durationMinutes: result.durationMinutes,
        });
      }
    }
    return result;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (externalSignal?.aborted) {
        if (ROUTE_API_DEBUG) routeDebug.polyAborted += 1;
        return { aborted: true };
      }
      return { error: 'Tiempo agotado al calcular la ruta' };
    }
    return { error: e instanceof Error ? e.message : 'Error de conexión' };
  }
}

export async function fetchRoute(
  origin: Point,
  destination: Point,
  waypoints: Point[] = [],
  options?: RouteFetchOptions
): Promise<RouteResult> {
  const base = getApiBase();
  if (!base) return { error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  const url = `${base}/api/route/polyline`;
  if (ROUTE_API_DEBUG) {
    console.log('API BASE:', process.env.EXPO_PUBLIC_API_BASE_URL);
    console.log('CALLING:', `${process.env.EXPO_PUBLIC_API_BASE_URL}/api/route/polyline`);
    if (base !== (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')) {
      console.log('[routeApi] nota: URL real del fetch = BASE usado (p. ej. desde app.config extra):', base);
    }
    console.log('[routeApi] BASE usado en fetch:', base);
  }
  const key = routePolylineRequestKey(origin, destination, waypoints);
  const externalSignal = options?.signal;

  if (externalSignal?.aborted) {
    if (ROUTE_API_DEBUG) routeDebug.polyAborted += 1;
    return { aborted: true };
  }

  pruneOldCacheEntries(routeResultCache, ROUTE_CLIENT_CACHE_MAX_ENTRIES);
  const cached = routeResultCache.get(key);
  if (cached && cached.expiresAt > Date.now() && !cached.result.error && !cached.result.aborted) {
    if (ROUTE_API_DEBUG) {
      routeDebug.polyCacheHit += 1;
      console.log('[routeApi] poly cache hit', key.slice(0, 80));
    }
    return cloneRouteResult(cached.result);
  }

  if (!externalSignal) {
    const inflight = routeInflight.get(key);
    if (inflight) {
      if (ROUTE_API_DEBUG) {
        routeDebug.polyInflightHit += 1;
        console.log('[routeApi] poly inflight dedupe', key.slice(0, 80));
      }
      return cloneRouteResult(await inflight);
    }
  }

  if (ROUTE_API_DEBUG) {
    routeDebug.polyFetch += 1;
    console.log('[routeApi] poly fetch', key.slice(0, 80));
  }

  const body = { origin, destination, waypoints };
  const promise = executePolylineFetch(url, body, externalSignal).then((result) => {
    const polyOk = Array.isArray(result.polyline) && result.polyline.length >= 2;
    if (!result.aborted && !result.error && polyOk) {
      routeResultCache.set(key, { expiresAt: Date.now() + ROUTE_CLIENT_CACHE_TTL_MS, result: cloneRouteResult(result) });
    }
    return result;
  });

  if (!externalSignal) {
    routeInflight.set(key, promise);
    promise.finally(() => {
      routeInflight.delete(key);
    });
  }

  return cloneRouteResult(await promise);
}

async function executeSegmentFetch(
  url: string,
  body: object,
  externalSignal?: AbortSignal
): Promise<SegmentStatsResult> {
  try {
    const res = await fetchWithTimeoutAndSignal(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      ROUTE_API_FETCH_TIMEOUT_MS,
      externalSignal
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (data as { error?: string }).error ?? 'Error al calcular tramo' };
    return {
      distanceKm: (data as { distanceKm?: number }).distanceKm,
      durationMinutes: (data as { durationMinutes?: number }).durationMinutes,
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (externalSignal?.aborted) {
        if (ROUTE_API_DEBUG) routeDebug.segAborted += 1;
        return { aborted: true };
      }
      return { error: 'Tiempo agotado al calcular el tramo' };
    }
    return { error: e instanceof Error ? e.message : 'Error de conexión' };
  }
}

/** POST /api/route/segment-stats — pickup → waypoints opcionales → dropoff (backend Next.js). */
export async function fetchSegmentStats(
  origin: Point,
  destination: Point,
  waypoints: Point[] = [],
  options?: RouteFetchOptions
): Promise<SegmentStatsResult> {
  const base = getApiBase();
  if (!base) return { error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  const key = segmentStatsRequestKey(origin, destination, waypoints);
  const externalSignal = options?.signal;

  if (externalSignal?.aborted) {
    if (ROUTE_API_DEBUG) routeDebug.segAborted += 1;
    return { aborted: true };
  }

  pruneOldCacheEntries(segmentResultCache, ROUTE_CLIENT_CACHE_MAX_ENTRIES);
  const cached = segmentResultCache.get(key);
  if (cached && cached.expiresAt > Date.now() && !cached.result.error && !cached.result.aborted) {
    if (ROUTE_API_DEBUG) {
      routeDebug.segCacheHit += 1;
      console.log('[routeApi] segment cache hit', key.slice(0, 80));
    }
    return cloneSegmentResult(cached.result);
  }

  if (!externalSignal) {
    const inflight = segmentInflight.get(key);
    if (inflight) {
      if (ROUTE_API_DEBUG) {
        routeDebug.segInflightHit += 1;
        console.log('[routeApi] segment inflight dedupe', key.slice(0, 80));
      }
      return cloneSegmentResult(await inflight);
    }
  }

  if (ROUTE_API_DEBUG) {
    routeDebug.segFetch += 1;
    console.log('[routeApi] segment fetch', key.slice(0, 80));
  }

  const body =
    waypoints.length > 0 ? { origin, destination, waypoints } : { origin, destination };
  const promise = executeSegmentFetch(`${base}/api/route/segment-stats`, body, externalSignal).then((result) => {
    if (!result.aborted && !result.error && result.distanceKm != null) {
      segmentResultCache.set(key, { expiresAt: Date.now() + ROUTE_CLIENT_CACHE_TTL_MS, result: cloneSegmentResult(result) });
    }
    return result;
  });

  if (!externalSignal) {
    segmentInflight.set(key, promise);
    promise.finally(() => {
      segmentInflight.delete(key);
    });
  }

  return cloneSegmentResult(await promise);
}
