import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { snapLatLngToNearestRoad, SNAP_TO_ROAD_MAX_METERS } from '@/lib/snap-to-road';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

/**
 * POST /api/route/snap-to-road
 * Body: { lat, lng }
 * Respuesta OK: { lat, lng, distanceMeters, source }
 * Sin vía cercana: 422 { error, code: 'not_on_road' }
 */
export async function POST(req: NextRequest) {
  try {
    const clientId = getClientId(req);
    if (!checkRateLimit(`snap-to-road:${clientId}`, WINDOW_MS, MAX_PER_WINDOW)) {
      return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 });
    }

    const body = (await req.json()) as { lat?: unknown; lng?: unknown };
    const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat);
    const lng = typeof body.lng === 'number' ? body.lng : Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: 'lat/lng inválidos', code: 'bad_request' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
    const snapped = await snapLatLngToNearestRoad(lat, lng, apiKey);
    if (!snapped) {
      return NextResponse.json(
        {
          error: 'No hay una calle cerca de ese punto. Centrá el mapa sobre una vía.',
          code: 'not_on_road',
          maxMeters: SNAP_TO_ROAD_MAX_METERS,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      lat: snapped.lat,
      lng: snapped.lng,
      distanceMeters: Math.round(snapped.distanceMeters),
      source: snapped.source,
    });
  } catch (error) {
    console.error('[route/snap-to-road] error:', error);
    return NextResponse.json({ error: 'Snap failed', code: 'snap_error' }, { status: 500 });
  }
}
