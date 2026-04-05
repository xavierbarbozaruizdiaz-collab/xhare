import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { computeGoogleDrivingRoute } from '@/lib/google-routes-polyline';

/** Máximo 40 solicitudes por minuto por cliente (evitar abuso / cuotas Google). */
const POLYLINE_WINDOW_MS = 60_000;
const POLYLINE_MAX_PER_WINDOW = 40;

/**
 * Contrato de respuesta (sin cambiar): `polyline` es `{ lat: number; lng: number }[]`.
 * No usar `{ latitude, longitude }` — el frontend actual espera lat/lng.
 */
const polylineCache = new Map<string, { data: unknown; expiresAt: number }>();

/** Rutas OK desde Google: reutilizar varios minutos. */
const CACHE_TTL_OK_MS = 5 * 60 * 1000;

/** Fallback / error: TTL corto para no “congelar” línea recta si Google se recupera. */
const CACHE_TTL_FALLBACK_MS = 45 * 1000;

type Point = { lat: number; lng: number };

function isValidLatLng(p: unknown): p is Point {
  if (p == null || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.lat === 'number' &&
    Number.isFinite(o.lat) &&
    typeof o.lng === 'number' &&
    Number.isFinite(o.lng)
  );
}

function cacheKey(origin: Point, destination: Point, waypoints: Point[]): string {
  const round = (p: Point) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  return [round(origin), round(destination), ...waypoints.map(round)].join('|');
}

function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function estimateFallback(points: Point[]): { polyline: Point[]; distanceKm: number; durationSeconds: number; durationMinutes: number } {
  const polyline = points.filter(isValidLatLng);
  let distanceKm = 0;
  for (let i = 0; i < polyline.length - 1; i++) distanceKm += haversineKm(polyline[i], polyline[i + 1]);
  const durationMinutes = Math.max(15, Math.ceil((distanceKm / 45) * 60));
  const durationSeconds = durationMinutes * 60;
  return { polyline, distanceKm, durationSeconds, durationMinutes };
}

function buildFallbackResult(origin: Point, destination: Point, waypoints: Point[], reason: string) {
  const wps = (waypoints || []).filter(isValidLatLng);
  const estimated = estimateFallback([origin, ...wps, destination]);
  return {
    ...estimated,
    fallback: true,
    fallbackReason: reason,
  };
}

/**
 * POST /api/route/polyline
 * Body: { origin: { lat, lng }, destination: { lat, lng }, waypoints?: { lat, lng }[] }
 * Motor: Google Routes API (computeRoutes). Requiere `GOOGLE_MAPS_API_KEY` en el servidor.
 */
export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request);
    if (!checkRateLimit(`polyline:${clientId}`, POLYLINE_WINDOW_MS, POLYLINE_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes de ruta. Intentá de nuevo en un minuto.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const origin = body.origin;
    const destination = body.destination;
    const waypointsRaw = body.waypoints ?? [];

    if (!isValidLatLng(origin) || !isValidLatLng(destination)) {
      return NextResponse.json(
        { error: 'origin and destination with numeric lat/lng required' },
        { status: 400 }
      );
    }

    const waypoints = Array.isArray(waypointsRaw) ? waypointsRaw.filter(isValidLatLng) : [];

    const key = cacheKey(origin, destination, waypoints);
    const cached = polylineCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) {
      console.warn('[route/polyline] fallback: GOOGLE_MAPS_API_KEY not configured');
      const fallbackResult = buildFallbackResult(origin, destination, waypoints, 'google_error');
      polylineCache.set(key, { data: fallbackResult, expiresAt: Date.now() + CACHE_TTL_FALLBACK_MS });
      return NextResponse.json(fallbackResult);
    }

    const google = await computeGoogleDrivingRoute(apiKey, origin, destination, waypoints);

    if (!google) {
      console.warn('[route/polyline] fallback: google_error');
      const fallbackResult = buildFallbackResult(origin, destination, waypoints, 'google_error');
      polylineCache.set(key, { data: fallbackResult, expiresAt: Date.now() + CACHE_TTL_FALLBACK_MS });
      return NextResponse.json(fallbackResult);
    }

    const distanceKm = google.distanceMeters / 1000;
    const durationSeconds = google.durationSeconds;
    const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    const result = {
      polyline: google.polyline,
      durationSeconds,
      durationMinutes,
      distanceKm,
      fallback: false,
    };

    console.log('[route/polyline] google_routes OK', {
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      durationMinutes,
      points: google.polyline.length,
    });

    polylineCache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_OK_MS });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[route/polyline] error:', error);
    return NextResponse.json({ error: 'Route request failed', code: 'polyline_error' }, { status: 500 });
  }
}
