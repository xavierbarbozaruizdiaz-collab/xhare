import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import {
  matchPassengerRoute,
  segmentAvailableSeats,
  type RouteMatchBoardingEvent,
  type RouteMatchBooking,
  type RouteMatchRide,
} from '@/lib/passenger-route-matching';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const bodySchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  seats: z.number().int().min(1).max(20).default(1),
  rideKind: z.enum(['all', 'internal', 'long_distance']).default('all'),
  pickupWindowStartIso: z.string().datetime().optional(),
  pickupWindowEndIso: z.string().datetime().optional(),
});

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

export async function POST(request: NextRequest) {
  const auth = await getAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!checkRateLimit(`route-matches:${getClientId(request, auth.user.id)}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: 'Demasiadas búsquedas. Esperá un momento.' }, { status: 429 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Origen, destino o filtros inválidos.' }, { status: 400 });
  }

  const now = new Date();
  const windowStartMs = body.pickupWindowStartIso
    ? new Date(body.pickupWindowStartIso).getTime()
    : null;
  const windowEndMs = body.pickupWindowEndIso
    ? new Date(body.pickupWindowEndIso).getTime()
    : null;
  const service = createServiceClient();
  const { data: rideRows, error: ridesError } = await service
    .from('rides')
    .select(
      'id,status,route_name,departure_time,started_at,estimated_duration_minutes,max_deviation_km,total_seats,available_seats,price_per_seat,origin_lat,origin_lng,origin_label,destination_lat,destination_lng,destination_label,base_route_polyline,driver_lat,driver_lng,driver_location_updated_at'
    )
    .in('status', ['published', 'en_route'])
    .order('departure_time', { ascending: true })
    .limit(300);

  if (ridesError) {
    console.error('[route-matches] rides:', ridesError.message);
    return NextResponse.json({ error: 'No se pudieron buscar los viajes.' }, { status: 500 });
  }

  const rides = (rideRows ?? []).filter((ride) => {
    if (ride.status === 'en_route') return true;
    const departureMs = new Date(String(ride.departure_time ?? '')).getTime();
    return Number.isFinite(departureMs) && departureMs > now.getTime();
  });
  const rideIds = rides.map((ride) => String(ride.id));
  if (rideIds.length === 0) {
    return NextResponse.json({ rides: [], refreshedAt: now.toISOString() });
  }

  const [bookingsRes, eventsRes, tripRequestsRes] = await Promise.all([
    service
      .from('bookings')
      .select(
        'id,ride_id,passenger_id,status,seats_count,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng'
      )
      .in('ride_id', rideIds)
      .neq('status', 'cancelled'),
    service
      .from('ride_boarding_events')
      .select('ride_id,booking_id,event_type')
      .in('ride_id', rideIds)
      .in('event_type', ['no_show', 'dropped_off']),
    service
      .from('trip_requests')
      .select('id,ride_id,user_id,seats')
      .in('ride_id', rideIds)
      .eq('status', 'accepted'),
  ]);

  if (bookingsRes.error || eventsRes.error || tripRequestsRes.error) {
    console.error(
      '[route-matches] capacity:',
      bookingsRes.error?.message ?? eventsRes.error?.message ?? tripRequestsRes.error?.message
    );
    return NextResponse.json({ error: 'No se pudieron calcular los cupos por tramo.' }, { status: 500 });
  }

  const bookingsByRide = new Map<string, RouteMatchBooking[]>();
  for (const booking of bookingsRes.data ?? []) {
    const rideId = String(booking.ride_id);
    const bucket = bookingsByRide.get(rideId) ?? [];
    bucket.push(booking as RouteMatchBooking);
    bookingsByRide.set(rideId, bucket);
  }
  // Solicitudes aceptadas todavía no son bookings: se reservan de forma conservadora
  // durante todo el recorrido para no ofrecer dos veces esos asientos.
  for (const request of tripRequestsRes.data ?? []) {
    const rideId = String(request.ride_id);
    const bucket = bookingsByRide.get(rideId) ?? [];
    if (bucket.some((booking) => booking.passenger_id === String(request.user_id))) continue;
    bucket.push({
      id: `trip-request:${String(request.id)}`,
      passenger_id: String(request.user_id),
      status: 'confirmed',
      seats_count: Number(request.seats ?? 1),
    });
    bookingsByRide.set(rideId, bucket);
  }
  const eventsByRide = new Map<string, RouteMatchBoardingEvent[]>();
  for (const event of eventsRes.data ?? []) {
    const rideId = String(event.ride_id);
    const bucket = eventsByRide.get(rideId) ?? [];
    bucket.push({
      booking_id: String(event.booking_id),
      event_type: String(event.event_type),
    });
    eventsByRide.set(rideId, bucket);
  }

  const matches: Array<Record<string, unknown>> = [];
  for (const rawRide of rides) {
    const ride = rawRide as RouteMatchRide & Record<string, unknown>;
    const fixedSeatPrice = Number(ride.price_per_seat ?? 0);
    const pricingMode = String(ride.pricing_mode ?? '');
    const isFixedTotalSplit = pricingMode === 'fixed_total_split';
    const isLongDistance = fixedSeatPrice > 0 || pricingMode === 'driver_seat_price' || isFixedTotalSplit;
    if (body.rideKind === 'long_distance' && !isLongDistance) continue;
    if (body.rideKind === 'internal' && isLongDistance) continue;
    if (isFixedTotalSplit && (ride.split_locked === true || ride.status !== 'published')) continue;

    const routeMatch = matchPassengerRoute(ride, body.origin, body.destination, now, 'search');
    if (!routeMatch) continue;
    const pickupMs = routeMatch.estimatedPickupIso
      ? new Date(routeMatch.estimatedPickupIso).getTime()
      : NaN;
    if (!Number.isFinite(pickupMs)) continue;
    if (windowStartMs != null && pickupMs < windowStartMs) continue;
    if (windowEndMs != null && pickupMs > windowEndMs) continue;

    const segmentSeats = segmentAvailableSeats(
      ride,
      routeMatch,
      bookingsByRide.get(String(ride.id)) ?? [],
      eventsByRide.get(String(ride.id)) ?? []
    );
    if (segmentSeats < body.seats) continue;
    const occupiedSeats = (bookingsByRide.get(String(ride.id)) ?? []).reduce(
      (sum, booking) => sum + Math.max(0, Number(booking.seats_count ?? 0)),
      0
    );
    const totalTripPricePyg = Number(ride.total_trip_price_pyg ?? 0);
    const estimatedSharePyg =
      isFixedTotalSplit && totalTripPricePyg > 0
        ? Math.ceil((totalTripPricePyg * body.seats) / Math.max(1, occupiedSeats + body.seats))
        : null;

    matches.push({
      ...rawRide,
      available_seats: segmentSeats,
      segment_available_seats: segmentSeats,
      passenger_route_match: routeMatch,
      is_live: ride.status === 'en_route',
      estimated_share_pyg: estimatedSharePyg,
      confirmed_split_seats: isFixedTotalSplit ? occupiedSeats : null,
    });
  }

  matches.sort((a, b) => {
    const ma = a.passenger_route_match as { estimatedPickupIso?: string; originDistanceMeters?: number; destinationDistanceMeters?: number };
    const mb = b.passenger_route_match as { estimatedPickupIso?: string; originDistanceMeters?: number; destinationDistanceMeters?: number };
    const ta = ma.estimatedPickupIso ? new Date(ma.estimatedPickupIso).getTime() : Infinity;
    const tb = mb.estimatedPickupIso ? new Date(mb.estimatedPickupIso).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return (
      Number(ma.originDistanceMeters ?? 0) +
      Number(ma.destinationDistanceMeters ?? 0) -
      Number(mb.originDistanceMeters ?? 0) -
      Number(mb.destinationDistanceMeters ?? 0)
    );
  });

  return NextResponse.json(
    { rides: matches, refreshedAt: now.toISOString() },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }
  );
}
