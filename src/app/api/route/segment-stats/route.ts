import { NextRequest, NextResponse } from 'next/server';

const OSRM_BASE = 'https://router.project-osrm.org';

type Point = { lat: number; lng: number };

function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * POST /api/route/segment-stats
 * Body: { origin: { lat, lng }, destination: { lat, lng } }
 * Returns distance (km) and duration (min) for the segment (pickup → dropoff).
 * Uses OSRM; fallback to haversine distance and estimated duration.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const origin = body.origin as Point;
    const destination = body.destination as Point;

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return NextResponse.json(
        { error: 'origin and destination with lat/lng required' },
        { status: 400 }
      );
    }

    const url = `${OSRM_BASE}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false`;

    const res = await fetch(url, {
      next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();

    if (data.code === 'Ok' && data.routes?.[0]) {
      const route = data.routes[0];
      const distanceKm = route.distance != null ? Number(route.distance) / 1000 : undefined;
      const durationSeconds = route.duration != null ? Number(route.duration) : undefined;
      const durationMinutes = durationSeconds != null ? Math.max(1, Math.ceil(durationSeconds / 60)) : undefined;
      return NextResponse.json({
        distanceKm: distanceKm ?? haversineKm(origin, destination),
        durationMinutes: durationMinutes ?? Math.max(1, Math.ceil((haversineKm(origin, destination) / 50) * 60)),
      });
    }

    const fallbackKm = haversineKm(origin, destination);
    const fallbackDurationMin = Math.max(1, Math.ceil((fallbackKm / 50) * 60));
    return NextResponse.json({
      distanceKm: fallbackKm,
      durationMinutes: fallbackDurationMin,
      fallback: true,
    });
  } catch (error) {
    console.error('Segment stats error:', error);
    return NextResponse.json(
      { error: 'Route request failed' },
      { status: 500 }
    );
  }
}
