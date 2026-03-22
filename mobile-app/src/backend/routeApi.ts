/**
 * Route polyline and duration: call Next.js API /api/route/polyline (OSRM).
 * Used for: driver publish (estimated duration, optional distance).
 */
import { env } from '../core/env';

type Point = { lat: number; lng: number };

function getApiBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

export type RouteResult = {
  polyline?: Array<{ lat: number; lng: number }>;
  durationMinutes?: number;
  distanceKm?: number;
  error?: string;
};

export async function fetchRoute(
  origin: Point,
  destination: Point,
  waypoints: Point[] = []
): Promise<RouteResult> {
  const base = getApiBase();
  if (!base) return { error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  const url = `${base}/api/route/polyline`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination, waypoints }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (data as { error?: string }).error ?? 'Error al obtener la ruta' };
    return {
      polyline: Array.isArray((data as { polyline?: unknown }).polyline) ? (data as { polyline: Array<{ lat: number; lng: number }> }).polyline : undefined,
      durationMinutes: (data as { durationMinutes?: number }).durationMinutes,
      distanceKm: (data as { distanceKm?: number }).distanceKm,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Error de conexión' };
  }
}

export type SegmentStatsResult = {
  distanceKm?: number;
  durationMinutes?: number;
  error?: string;
};

/** POST /api/route/segment-stats — OSRM: pickup → waypoints opcionales → dropoff. */
export async function fetchSegmentStats(
  origin: Point,
  destination: Point,
  waypoints: Point[] = []
): Promise<SegmentStatsResult> {
  const base = getApiBase();
  if (!base) return { error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  try {
    const res = await fetch(`${base}/api/route/segment-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin,
        destination,
        ...(waypoints.length > 0 ? { waypoints } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (data as { error?: string }).error ?? 'Error al calcular tramo' };
    return {
      distanceKm: (data as { distanceKm?: number }).distanceKm,
      durationMinutes: (data as { durationMinutes?: number }).durationMinutes,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Error de conexión' };
  }
}
