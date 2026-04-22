/**
 * Google Routes API (computeRoutes) — solo servidor.
 * Docs: https://developers.google.com/maps/documentation/routes/compute_route_directions
 */

export type LatLngPoint = { lat: number; lng: number };

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

/** Máximo de intermediates por petición según la API de Routes. */
const MAX_INTERMEDIATES_PER_REQUEST = 25;

function getGoogleRoutesTimeoutMs(): number {
  const n = Number(process.env.GOOGLE_ROUTES_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 3_000 && n <= 60_000) return Math.floor(n);
  return 15_000;
}

/** Agrupación hex (Hobby): tope 12s para no bloquear el cron. */
export function getGoogleRoutesTimeoutMsHexCap(): number {
  return Math.min(12_000, getGoogleRoutesTimeoutMs());
}

const FIELD_MASK_WITH_WAYPOINT_OPTIMIZATION =
  'routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

function isValidLatLngPoint(p: unknown): p is LatLngPoint {
  if (p == null || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.lat === 'number' &&
    Number.isFinite(o.lat) &&
    typeof o.lng === 'number' &&
    Number.isFinite(o.lng)
  );
}

/**
 * Decodifica una polilínea codificada (precisión 1e5) a `{ lat, lng }[]` (contrato del endpoint).
 */
export function decodeEncodedPolyline(encoded: string): LatLngPoint[] {
  const coordinates: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return coordinates;
}

function parseGoogleDurationSeconds(duration: unknown): number | null {
  if (typeof duration !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
  if (!m) return null;
  return Math.round(parseFloat(m[1]));
}

async function fetchComputeRoutesSegment(
  apiKey: string,
  origin: LatLngPoint,
  destination: LatLngPoint,
  intermediates: LatLngPoint[],
  signal: AbortSignal
): Promise<{ distanceMeters: number; durationSeconds: number; polyline: LatLngPoint[] } | null> {
  const body: Record<string, unknown> = {
    origin: {
      location: {
        latLng: { latitude: origin.lat, longitude: origin.lng },
      },
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lng },
      },
    },
    travelMode: 'DRIVE',
  };

  if (intermediates.length > 0) {
    body.intermediates = intermediates.map((p) => ({
      location: {
        latLng: { latitude: p.lat, longitude: p.lng },
      },
    }));
  }

  const res = await fetch(COMPUTE_ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });

  if (!res.ok) return null;

  let data: { routes?: Array<Record<string, unknown>> };
  try {
    data = (await res.json()) as { routes?: Array<Record<string, unknown>> };
  } catch {
    return null;
  }

  const route = data.routes?.[0];
  if (!route) return null;

  const polyObj = route.polyline as { encodedPolyline?: string } | undefined;
  const enc = polyObj?.encodedPolyline;
  if (!enc || typeof enc !== 'string') return null;

  const durationSeconds = parseGoogleDurationSeconds(route.duration);
  if (durationSeconds == null) return null;

  const distanceMeters = Number(route.distanceMeters);
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;

  const polyline = decodeEncodedPolyline(enc);
  if (polyline.length < 2) return null;

  return { polyline, distanceMeters, durationSeconds };
}

/**
 * Origen → (hasta 25 intermedios por tramo) → destino. Suma distancia y duración de cada tramo.
 */
export async function computeGoogleDrivingRoute(
  apiKey: string,
  origin: LatLngPoint,
  destination: LatLngPoint,
  waypoints: LatLngPoint[]
): Promise<{ polyline: LatLngPoint[]; distanceMeters: number; durationSeconds: number } | null> {
  const chain: LatLngPoint[] = [
    origin,
    ...waypoints.filter(isValidLatLngPoint),
    destination,
  ];
  if (chain.length < 2) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getGoogleRoutesTimeoutMs());

  try {
    let fullPoly: LatLngPoint[] = [];
    let totalDistanceM = 0;
    let totalDurationS = 0;
    let i = 0;

    while (i < chain.length - 1) {
      const segOrigin = chain[i];
      const remainingAfterOrigin = chain.length - 1 - i;
      const intermediatesCount = Math.min(MAX_INTERMEDIATES_PER_REQUEST, Math.max(0, remainingAfterOrigin - 1));
      const endIndex = i + 1 + intermediatesCount;
      const segDest = chain[endIndex];
      const segIntermediates = chain.slice(i + 1, endIndex);

      const seg = await fetchComputeRoutesSegment(apiKey, segOrigin, segDest, segIntermediates, controller.signal);
      if (!seg) return null;

      if (fullPoly.length === 0) {
        fullPoly = seg.polyline;
      } else if (seg.polyline.length > 0) {
        const first = seg.polyline[0];
        const last = fullPoly[fullPoly.length - 1];
        const dup =
          last &&
          first &&
          Math.abs(last.lat - first.lat) < 1e-6 &&
          Math.abs(last.lng - first.lng) < 1e-6;
        fullPoly.push(...(dup ? seg.polyline.slice(1) : seg.polyline));
      }

      totalDistanceM += seg.distanceMeters;
      totalDurationS += seg.durationSeconds;
      i = endIndex;
    }

    if (fullPoly.length < 2) return null;

    return {
      polyline: fullPoly,
      distanceMeters: totalDistanceM,
      durationSeconds: totalDurationS,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type OptimizedPickupRouteResult = {
  /** Índices en el array de intermediates en el orden de visita tras el origen fijo. */
  optimizedIntermediateWaypointIndex: number[];
  distanceMeters: number;
  durationSeconds: number;
  polyline: LatLngPoint[];
};

/** Alias semántico: misma respuesta que optimización de pickups. */
export type OptimizedDropoffRouteResult = OptimizedPickupRouteResult;

async function computeRoutesOptimizeWaypointOrder(
  apiKey: string,
  origin: LatLngPoint,
  destination: LatLngPoint,
  intermediates: LatLngPoint[],
  timeoutMs: number
): Promise<OptimizedPickupRouteResult | null> {
  if (!isValidLatLngPoint(origin) || !isValidLatLngPoint(destination)) return null;
  const mids = intermediates.filter(isValidLatLngPoint);
  if (mids.length > MAX_INTERMEDIATES_PER_REQUEST) return null;

  const body: Record<string, unknown> = {
    origin: {
      location: {
        latLng: { latitude: origin.lat, longitude: origin.lng },
      },
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lng },
      },
    },
    travelMode: 'DRIVE',
    optimizeWaypointOrder: true,
  };

  if (mids.length > 0) {
    body.intermediates = mids.map((p) => ({
      location: {
        latLng: { latitude: p.lat, longitude: p.lng },
      },
    }));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(COMPUTE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK_WITH_WAYPOINT_OPTIMIZATION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) return null;

    let data: { routes?: Array<Record<string, unknown>> };
    try {
      data = (await res.json()) as { routes?: Array<Record<string, unknown>> };
    } catch {
      return null;
    }

    const route = data.routes?.[0];
    if (!route) return null;

    const rawIdx = route.optimizedIntermediateWaypointIndex;
    let ordered: number[];
    if (mids.length === 0) {
      ordered = [];
    } else if (Array.isArray(rawIdx) && rawIdx.length === mids.length) {
      ordered = rawIdx.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n < mids.length);
      if (ordered.length !== mids.length) {
        ordered = mids.map((_, i) => i);
      }
    } else {
      ordered = mids.map((_, i) => i);
    }

    const polyObj = route.polyline as { encodedPolyline?: string } | undefined;
    const enc = polyObj?.encodedPolyline;
    if (!enc || typeof enc !== 'string') return null;

    const durationSeconds = parseGoogleDurationSeconds(route.duration);
    if (durationSeconds == null) return null;

    const distanceMeters = Number(route.distanceMeters);
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;

    const polyline = decodeEncodedPolyline(enc);
    if (polyline.length < 2) return null;

    return {
      optimizedIntermediateWaypointIndex: ordered,
      distanceMeters,
      durationSeconds,
      polyline,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fase 1 PDP: origen = primer pickup; intermediates = resto de pickups; destino = cierre (p. ej. centroide drops).
 * `optimizeWaypointOrder: true` en Routes API v2.
 */
export async function computePickupOrderWithGoogle(
  apiKey: string,
  firstPickup: LatLngPoint,
  dropoffAnchor: LatLngPoint,
  intermediatePickups: LatLngPoint[],
  timeoutMs?: number
): Promise<OptimizedPickupRouteResult | null> {
  const tMs = Math.min(12_000, Math.max(3_000, timeoutMs ?? getGoogleRoutesTimeoutMsHexCap()));
  const mids = intermediatePickups.filter(isValidLatLngPoint);
  if (mids.length > MAX_INTERMEDIATES_PER_REQUEST) return null;
  return computeRoutesOptimizeWaypointOrder(apiKey, firstPickup, dropoffAnchor, mids, tMs);
}

/**
 * Fase 2 PDP: origen = última recogida (posición tras pickups); intermediates = n−1 destinos;
 * destino fijo = destino del último pasajero en el orden de recogida (cierra la ruta de entregas).
 */
export async function computeDropoffOrderWithGoogle(
  apiKey: string,
  lastPickupLocation: LatLngPoint,
  intermediateDropoffs: LatLngPoint[],
  finalDropoff: LatLngPoint,
  timeoutMs?: number
): Promise<OptimizedDropoffRouteResult | null> {
  const tMs = Math.min(12_000, Math.max(3_000, timeoutMs ?? getGoogleRoutesTimeoutMsHexCap()));
  const mids = intermediateDropoffs.filter(isValidLatLngPoint);
  if (mids.length > MAX_INTERMEDIATES_PER_REQUEST) return null;
  return computeRoutesOptimizeWaypointOrder(apiKey, lastPickupLocation, finalDropoff, mids, tMs);
}
