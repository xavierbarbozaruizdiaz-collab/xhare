import { NextRequest, NextResponse } from 'next/server';

const OSRM_BASE = 'https://router.project-osrm.org';

type Point = { lat: number; lng: number };

/**
 * POST /api/route/segment-stats
 * Body: { origin: { lat, lng }, destination: { lat, lng }, waypoints?: { lat, lng }[] }
 * waypoints: puntos intermedios en orden (ej. paradas del pasajero entre recogida y descenso).
 * Returns distance (km) and duration (min) for the recorrido completo vía OSRM.
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
    const url = `${OSRM_BASE}/route/v1/driving/${path}?overview=false`;

    let data: any;
    try {
      const res = await fetch(url, {
        next: { revalidate: 60 },
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: 'Network error contacting OSRM', code: 'osrm_network_error', status: res.status },
          { status: 503 }
        );
      }
      data = await res.json();
    } catch (err) {
      console.error('OSRM segment-stats fetch error:', err);
      return NextResponse.json(
        { error: 'Network error contacting OSRM', code: 'osrm_network_error' },
        { status: 503 }
      );
    }

    if (data.code === 'Ok' && data.routes?.[0]) {
      const route = data.routes[0];
      const distanceKm = route.distance != null ? Number(route.distance) / 1000 : null;
      const durationSeconds = route.duration != null ? Number(route.duration) : null;
      if (distanceKm == null || durationSeconds == null) {
        return NextResponse.json(
          { error: 'OSRM did not return distance/duration' },
          { status: 502 }
        );
      }
      const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
      return NextResponse.json({
        distanceKm,
        durationMinutes,
      });
    }

    return NextResponse.json(
      { error: 'OSRM route not found', code: 'osrm_no_route' },
      { status: 502 }
    );
  } catch (error) {
    console.error('Segment stats error:', error);
    return NextResponse.json(
      { error: 'Route request failed', code: 'segment_stats_error' },
      { status: 500 }
    );
  }
}
