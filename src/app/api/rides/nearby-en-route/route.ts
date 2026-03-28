import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { getAuth } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { distanceMeters, distancePointToPolylineMeters } from '@/lib/geo';
import type { Point } from '@/types';

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Corredor: la ruta (OSRM guardada) pasa cerca del pasajero. */
const ROUTE_WITHIN_M = 1000;
/** Corona: conductor entre 2 km y 3 km del pasajero (no encima, no demasiado lejos). */
const DRIVER_MIN_M = 2000;
const DRIVER_MAX_M = 3000;
/** Pre-filtro en BD: caja ~3,5 km alrededor del pasajero (driver_lat/lng). */
const BBOX_BUFFER_M = 3500;
const MAX_RESULTS = 24;
const MAX_POLYLINE_POINTS = 80;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 24;

function parseBaseRoutePolyline(raw: unknown): Point[] {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const out: Point[] = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const o = p as { lat?: unknown; lng?: unknown };
      const lat = Number(o.lat);
      const lng = Number(o.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    } else if (Array.isArray(p) && p.length >= 2) {
      const lng = Number(p[0]);
      const lat = Number(p[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
  }
  return out.length >= 2 ? out : [];
}

function decimatePolyline(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  if (!prev || prev.lat !== last.lat || prev.lng !== last.lng) out.push(last);
  return out;
}

function bboxDeltas(lat: number, meters: number): { dLat: number; dLng: number } {
  const dLat = meters / 111_000;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = meters / (111_000 * Math.max(0.25, Math.abs(cosLat)));
  return { dLat, dLng };
}

/**
 * POST { lat, lng } — Viajes en_route con asientos, conductor en corona 2–3 km y ruta a ≤1 km del pasajero.
 * Prefiltro geográfico en SQL; filtro fino en servidor (polyline + distancias).
 */
export async function POST(request: NextRequest) {
  const auth = await getAuth(request);
  if (auth instanceof NextResponse) return auth;

  const clientId = getClientId(request, auth.user.id);
  if (!checkRateLimit(`nearby-en-route:${clientId}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Esperá un momento.' },
      { status: 429 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Coordenadas inválidas' }, { status: 400 });
  }

  const { lat, lng } = body;
  const { dLat, dLng } = bboxDeltas(lat, BBOX_BUFFER_M);
  const service = createServiceClient();

  const { data: rows, error } = await service
    .from('rides')
    .select(
      'id, driver_lat, driver_lng, available_seats, base_route_polyline, origin_label, destination_label, price_per_seat'
    )
    .eq('status', 'en_route')
    .gt('available_seats', 0)
    .not('driver_lat', 'is', null)
    .not('driver_lng', 'is', null)
    .gte('driver_lat', lat - dLat)
    .lte('driver_lat', lat + dLat)
    .gte('driver_lng', lng - dLng)
    .lte('driver_lng', lng + dLng);

  if (error) {
    console.error('[nearby-en-route]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const passenger: Point = { lat, lng };
  const matches: Array<{
    id: string;
    driver_lat: number;
    driver_lng: number;
    available_seats: number;
    distance_route_m: number;
    distance_driver_m: number;
    polyline: Point[];
    origin_label: string | null;
    destination_label: string | null;
    price_per_seat: number | null;
  }> = [];

  for (const r of rows ?? []) {
    const dLatDriver = Number(r.driver_lat);
    const dLngDriver = Number(r.driver_lng);
    if (!Number.isFinite(dLatDriver) || !Number.isFinite(dLngDriver)) continue;

    const driverPt: Point = { lat: dLatDriver, lng: dLngDriver };
    const dDriver = distanceMeters(passenger, driverPt);
    if (dDriver <= DRIVER_MIN_M || dDriver > DRIVER_MAX_M) continue;

    const poly = parseBaseRoutePolyline(r.base_route_polyline);
    if (poly.length < 2) continue;

    const dPoly = distancePointToPolylineMeters(passenger, poly);
    if (dPoly > ROUTE_WITHIN_M) continue;

    matches.push({
      id: r.id as string,
      driver_lat: dLatDriver,
      driver_lng: dLngDriver,
      available_seats: Math.max(0, Number(r.available_seats ?? 0)),
      distance_route_m: Math.round(dPoly),
      distance_driver_m: Math.round(dDriver),
      polyline: decimatePolyline(poly, MAX_POLYLINE_POINTS),
      origin_label: r.origin_label != null ? String(r.origin_label) : null,
      destination_label: r.destination_label != null ? String(r.destination_label) : null,
      price_per_seat: r.price_per_seat != null ? Number(r.price_per_seat) : null,
    });
  }

  matches.sort((a, b) => a.distance_driver_m - b.distance_driver_m);
  const rides = matches.slice(0, MAX_RESULTS);

  return NextResponse.json({
    rides,
    criteria: {
      route_within_m: ROUTE_WITHIN_M,
      driver_between_m: [DRIVER_MIN_M, DRIVER_MAX_M] as const,
      requires_available_seats: true,
    },
  });
}
