import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const OSRM_BASE = 'https://router.project-osrm.org';

/** Máximo 40 solicitudes por minuto por cliente (evitar abuso / saturar OSRM). */
const POLYLINE_WINDOW_MS = 60_000;
const POLYLINE_MAX_PER_WINDOW = 40;

/** Caché en memoria: misma ruta no vuelve a OSRM por 5 min. Para multi-instancia usar Redis. */
const polylineCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

type Point = { lat: number; lng: number };

function cacheKey(origin: Point, destination: Point, waypoints: Point[]): string {
  const round = (p: Point) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  return [round(origin), round(destination), ...waypoints.map(round)].join('|');
}

function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Estima duración en minutos suponiendo ~50 km/h cuando OSRM no devuelve ruta */
function estimateDurationMinutesFromPoints(points: Point[]): number {
  if (!points || points.length < 2) return 60;
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) km += haversineKm(points[i], points[i + 1]);
  return Math.max(15, Math.ceil((km / 50) * 60));
}

/**
 * POST /api/route/polyline
 * Body: { origin: { lat, lng }, destination: { lat, lng }, waypoints?: { lat, lng }[] }
 * Llama a OSRM desde el servidor para evitar CORS y límites en el cliente.
 * Rate limited y cacheado para producción (~2000 usuarios).
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
    const origin = body.origin as Point;
    const destination = body.destination as Point;
    const waypoints = (body.waypoints ?? []) as Point[];

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return NextResponse.json(
        { error: 'origin and destination with lat/lng required' },
        { status: 400 }
      );
    }

    const key = cacheKey(origin, destination, waypoints);
    const cached = polylineCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    let url = `${OSRM_BASE}/route/v1/driving/${origin.lng},${origin.lat}`;
    (waypoints || []).forEach((wp: Point) => {
      if (wp?.lat != null && wp?.lng != null) url += `;${wp.lng},${wp.lat}`;
    });
    url += `;${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

    const res = await fetch(url, {
      next: { revalidate: 60 },
      headers: { 'Accept': 'application/json' },
    });
    const data = await res.json();

    if (data.code === 'Ok' && data.routes?.[0]) {
      const route = data.routes[0];
      const coords = route.geometry?.coordinates as [number, number][] | undefined;
      const polyline = coords?.length
        ? coords.map(([lng, lat]) => ({ lat, lng }))
        : [origin, ...(waypoints || []), destination].filter((p: Point) => p?.lat != null && p?.lng != null);
      const durationSeconds = route.duration != null ? Number(route.duration) : undefined;
      const durationMinutes = durationSeconds != null ? Math.max(1, Math.ceil(durationSeconds / 60)) : undefined;
      const result = { polyline, durationSeconds, durationMinutes };
      polylineCache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json(result);
    }

    // OSRM puede devolver NoRoute, etc.; estimamos duración por distancia en línea recta (~50 km/h)
    const fallbackPoints = [origin, ...(waypoints || []), destination].filter((p: Point) => p?.lat != null && p?.lng != null);
    const durationMinutes = estimateDurationMinutesFromPoints(fallbackPoints);
    const fallbackResult = { polyline: fallbackPoints, durationMinutes, fallback: true };
    polylineCache.set(key, { data: fallbackResult, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(fallbackResult);
  } catch (error) {
    console.error('OSRM polyline error:', error);
    return NextResponse.json(
      { error: 'Route request failed' },
      { status: 500 }
    );
  }
}
