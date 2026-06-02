import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { computeGoogleDrivingRoute } from '@/lib/google-routes-polyline';

type Point = { lat: number; lng: number };

const SEGMENT_STATS_WINDOW_MS = 60_000;
const SEGMENT_STATS_MAX_PER_WINDOW = 90;

const statsCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_OK_MS = 5 * 60 * 1000;
const CACHE_TTL_FALLBACK_MS = 45 * 1000;

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

function estimateFallback(origin: Point, destination: Point, waypoints: Point[], reason: string) {
  const points = [origin, ...waypoints, destination].filter(isValidLatLng);
  let distanceKm = 0;
  for (let i = 0; i < points.length - 1; i++) distanceKm += haversineKm(points[i], points[i + 1]);
  const durationMinutes = Math.max(15, Math.ceil((distanceKm / 45) * 60));
  return { distanceKm, durationMinutes, fallback: true, fallbackReason: reason };
}

/**
 * POST /api/route/segment-stats
 * Body: { origin: { lat, lng }, destination: { lat, lng }, waypoints?: { lat, lng }[] }
 * Motor: Google Routes API (mismo que `/api/route/polyline`).
 */
export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request);
    if (!checkRateLimit(`segment-stats:${clientId}`, SEGMENT_STATS_WINDOW_MS, SEGMENT_STATS_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const origin = body.origin;
    const destination = body.destination;
    const waypointsRaw = body.waypoints ?? [];

    if (!isValidLatLng(origin) || !isValidLatLng(destination)) {
      return NextResponse.json(
        { error: 'origin and destination with lat/lng required' },
        { status: 400 }
      );
    }

    const waypoints = Array.isArray(waypointsRaw) ? waypointsRaw.filter(isValidLatLng) : [];

    const key = cacheKey(origin, destination, waypoints);
    const cached = statsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) {
      console.warn('[route/segment-stats] fallback: GOOGLE_MAPS_API_KEY not configured');
      const fallbackResult = estimateFallback(origin, destination, waypoints, 'google_error');
      statsCache.set(key, { data: fallbackResult, expiresAt: Date.now() + CACHE_TTL_FALLBACK_MS });
      return NextResponse.json(fallbackResult);
    }

    const google = await computeGoogleDrivingRoute(apiKey, origin, destination, waypoints);

    if (!google) {
      console.warn('[route/segment-stats] fallback: google_error');
      const fallbackResult = estimateFallback(origin, destination, waypoints, 'google_error');
      statsCache.set(key, { data: fallbackResult, expiresAt: Date.now() + CACHE_TTL_FALLBACK_MS });
      return NextResponse.json(fallbackResult);
    }

    const result = {
      distanceKm: google.distanceMeters / 1000,
      durationMinutes: Math.max(1, Math.ceil(google.durationSeconds / 60)),
      fallback: false,
    };

    statsCache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_OK_MS });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[route/segment-stats] error:', error);
    return NextResponse.json(
      { error: 'Route request failed', code: 'segment_stats_error' },
      { status: 500 }
    );
  }
}
