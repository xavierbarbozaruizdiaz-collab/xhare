import { NextRequest, NextResponse } from 'next/server';
import { getOsrmBaseUrl, getOsrmRequestTimeoutMs } from '@/lib/osrm-routing';

type Point = { lat: number; lng: number };

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

function estimateFallback(origin: Point, destination: Point, waypoints: Point[]) {
  const points = [origin, ...waypoints, destination].filter((p) => p?.lat != null && p?.lng != null);
  let distanceKm = 0;
  for (let i = 0; i < points.length - 1; i++) distanceKm += haversineKm(points[i], points[i + 1]);
  const durationMinutes = Math.max(15, Math.ceil((distanceKm / 45) * 60));
  return { distanceKm, durationMinutes, fallback: true };
}

/**
 * POST /api/route/segment-stats
 * Body: { origin: { lat, lng }, destination: { lat, lng }, waypoints?: { lat, lng }[] }
 * waypoints: puntos intermedios en orden (ej. paradas del pasajero entre recogida y descenso).
 * Returns distance (km) and duration (min) for the recorrido completo vía motor OSRM-compatible.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const origin = body.origin as Point;
    const destination = body.destination as Point;
    const waypoints = Array.isArray(body.waypoints) ? (body.waypoints as Point[]) : [];

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return NextResponse.json(
        { error: 'origin and destination with lat/lng required' },
        { status: 400 }
      );
    }

    const MAX_VIA = 8;
    const via = waypoints
      .filter((p) => p?.lat != null && p?.lng != null)
      .slice(0, MAX_VIA);
    const coords: Point[] = [origin, ...via, destination];
    const path = coords.map((p) => `${p.lng},${p.lat}`).join(';');
    const OSRM_BASE = getOsrmBaseUrl();
    const OSRM_TIMEOUT_MS = getOsrmRequestTimeoutMs();
    const url = `${OSRM_BASE}/route/v1/driving/${path}?overview=false`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!res.ok) {
        return NextResponse.json({
          ...estimateFallback(origin, destination, via),
          fallbackReason: `osrm_http_${res.status}`,
        });
      }
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]) {
        const route = data.routes[0];
        const distanceKm = route.distance != null ? Number(route.distance) / 1000 : null;
        const durationSeconds = route.duration != null ? Number(route.duration) : null;
        if (distanceKm == null || durationSeconds == null) {
          return NextResponse.json({
            ...estimateFallback(origin, destination, via),
            fallbackReason: 'osrm_missing_distance_or_duration',
          });
        }
        return NextResponse.json({
          distanceKm,
          durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
          fallback: false,
        });
      }
    } catch (err) {
      console.error('OSRM segment-stats fetch error:', err);
      return NextResponse.json({
        ...estimateFallback(origin, destination, via),
        fallbackReason: 'osrm_network_error',
      });
    }
    return NextResponse.json({
      ...estimateFallback(origin, destination, via),
      fallbackReason: 'osrm_no_route',
    });
  } catch (error) {
    console.error('Segment stats error:', error);
    return NextResponse.json(
      { error: 'Route request failed', code: 'segment_stats_error' },
      { status: 500 }
    );
  }
}
