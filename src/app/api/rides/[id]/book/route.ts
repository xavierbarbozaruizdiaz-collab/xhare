import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  matchPassengerRoute,
  segmentAvailableSeats,
  type RouteMatchBooking,
  type RouteMatchBoardingEvent,
  type RouteMatchRide,
} from '@/lib/passenger-route-matching';

const nullableUuid = z.string().uuid().nullable().optional();
const nullableText = z.string().max(500).nullable().optional();

const bodySchema = z.object({
  bookingId: z.string().uuid().optional(),
  seatsCount: z.number().int().min(1).max(20),
  pricePaid: z.number().min(0),
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: nullableText,
    stopId: nullableUuid,
  }),
  dropoff: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: nullableText,
    stopId: nullableUuid,
  }),
  pricingSnapshot: z.unknown().optional(),
  pricingSettingsId: nullableUuid,
  segmentDistanceKm: z.number().min(0).nullable().optional(),
  baseFare: z.number().min(0).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await getAuth(request);
  if (auth instanceof NextResponse) return auth;
  const rideId = params.id;
  if (!z.string().uuid().safeParse(rideId).success) {
    return NextResponse.json({ error: 'Viaje inválido.' }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Los datos de la reserva son inválidos.' }, { status: 400 });
  }

  const service = createServiceClient();
  const [existingBookingRes, acceptedRequestRes] = await Promise.all([
    service
      .from('bookings')
      .select('id,status,payment_status')
      .eq('ride_id', rideId)
      .eq('passenger_id', auth.user.id)
      .neq('status', 'cancelled')
      .maybeSingle(),
    service
      .from('trip_requests')
      .select('id')
      .eq('ride_id', rideId)
      .eq('user_id', auth.user.id)
      .eq('status', 'accepted')
      .limit(1)
      .maybeSingle(),
  ]);
  if (existingBookingRes.error || acceptedRequestRes.error) {
    return NextResponse.json({ error: 'No se pudo verificar tu reserva.' }, { status: 500 });
  }
  if (body.bookingId && existingBookingRes.data?.id !== body.bookingId) {
    return NextResponse.json({ error: 'Reserva no encontrada.' }, { status: 404 });
  }
  if (
    body.bookingId &&
    (existingBookingRes.data?.payment_status !== 'pending' ||
      !['pending', 'confirmed'].includes(String(existingBookingRes.data?.status ?? '')))
  ) {
    return NextResponse.json(
      { error: 'Esta reserva ya no se puede modificar.', code: 'BOOKING_EDIT_LOCKED' },
      { status: 409 }
    );
  }
  if (!body.bookingId && (existingBookingRes.data || acceptedRequestRes.data)) {
    return NextResponse.json({ error: 'Ya tenés una reserva en este viaje.', code: 'DUPLICATE_BOOKING' }, { status: 409 });
  }

  const { data: rideRow, error: rideError } = await service
    .from('rides')
    .select(
      'id,status,departure_time,estimated_duration_minutes,max_deviation_km,total_seats,price_per_seat,base_route_polyline,origin_lat,origin_lng,destination_lat,destination_lng,driver_lat,driver_lng,driver_location_updated_at'
    )
    .eq('id', rideId)
    .maybeSingle();
  if (rideError || !rideRow) {
    return NextResponse.json({ error: 'El viaje ya no está disponible.' }, { status: 404 });
  }

  const ride = rideRow as RouteMatchRide & {
    price_per_seat?: number | null;
    pricing_mode?: string | null;
    total_trip_price_pyg?: number | null;
    split_locked?: boolean | null;
  };
  const pricingMode =
    ride.pricing_mode === 'fixed_total_split'
      ? 'fixed_total_split'
      : Number(ride.price_per_seat ?? 0) > 0
        ? 'driver_seat_price'
        : 'segment';
  if (pricingMode === 'fixed_total_split' && (ride.split_locked || ride.status !== 'published')) {
    return NextResponse.json(
      { error: 'El reparto ya quedó fijado porque el viaje comenzó.', code: 'FIXED_TOTAL_SPLIT_LOCKED' },
      { status: 409 }
    );
  }
  const match = matchPassengerRoute(ride, body.pickup, body.dropoff);
  if (!match) {
    return NextResponse.json(
      { error: 'El tramo ya no coincide con el recorrido disponible.', code: 'ROUTE_NO_LONGER_MATCHES' },
      { status: 409 }
    );
  }

  const [bookingsRes, eventsRes, tripRequestsRes] = await Promise.all([
    service
      .from('bookings')
      .select(
        'id,passenger_id,status,seats_count,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng'
      )
      .eq('ride_id', rideId)
      .neq('status', 'cancelled'),
    service
      .from('ride_boarding_events')
      .select('booking_id,event_type')
      .eq('ride_id', rideId)
      .in('event_type', ['no_show', 'dropped_off']),
    service
      .from('trip_requests')
      .select('id,user_id,seats')
      .eq('ride_id', rideId)
      .eq('status', 'accepted'),
  ]);
  if (bookingsRes.error || eventsRes.error || tripRequestsRes.error) {
    return NextResponse.json({ error: 'No se pudieron confirmar los cupos del tramo.' }, { status: 500 });
  }
  const allExistingBookings = (bookingsRes.data ?? []) as RouteMatchBooking[];
  const existingBookings = body.bookingId
    ? allExistingBookings.filter((booking) => booking.id !== body.bookingId)
    : [...allExistingBookings];
  for (const request of tripRequestsRes.data ?? []) {
    if (allExistingBookings.some((booking) => booking.passenger_id === String(request.user_id))) continue;
    existingBookings.push({
      id: `trip-request:${String(request.id)}`,
      passenger_id: String(request.user_id),
      status: 'confirmed',
      seats_count: Number(request.seats ?? 1),
    });
  }
  const available = segmentAvailableSeats(
    ride,
    match,
    existingBookings,
    (eventsRes.data ?? []) as RouteMatchBoardingEvent[]
  );
  if (available < body.seatsCount) {
    return NextResponse.json(
      { error: 'Los cupos de este tramo acaban de cambiar.', code: 'SEGMENT_CAPACITY_EXCEEDED', available },
      { status: 409 }
    );
  }

  const mutableBookingValues = {
      seats_count: body.seatsCount,
      price_paid:
        pricingMode === 'fixed_total_split'
          ? 0
          : pricingMode === 'driver_seat_price'
            ? Math.max(0, Number(ride.price_per_seat ?? 0)) * body.seatsCount
            : body.pricePaid,
      pickup_lat: body.pickup.lat,
      pickup_lng: body.pickup.lng,
      pickup_label: body.pickup.label ?? null,
      dropoff_lat: body.dropoff.lat,
      dropoff_lng: body.dropoff.lng,
      dropoff_label: body.dropoff.label ?? null,
      pickup_stop_id: body.pickup.stopId ?? null,
      dropoff_stop_id: body.dropoff.stopId ?? null,
      selected_seat_ids: null,
      pricing_snapshot:
        pricingMode === 'fixed_total_split'
          ? {
              pricing_mode: 'fixed_total_split',
              total_trip_price_pyg: Number(ride.total_trip_price_pyg ?? 0),
              estimated: true,
            }
          : body.pricingSnapshot ?? null,
      pricing_settings_id: body.pricingSettingsId ?? null,
      segment_distance_km: body.segmentDistanceKm ?? null,
      base_fare: body.baseFare ?? null,
    };
  const bookingQuery = body.bookingId
    ? service
        .from('bookings')
        .update(mutableBookingValues)
        .eq('id', body.bookingId)
        .eq('passenger_id', auth.user.id)
    : service.from('bookings').insert({
        ...mutableBookingValues,
        ride_id: rideId,
        passenger_id: auth.user.id,
        status: 'pending',
        payment_status: 'pending',
      });
  const { data: booking, error: insertError } = await bookingQuery
    .select('id,booking_code,status,price_paid')
    .single();

  if (insertError) {
    const duplicate = insertError.code === '23505' || /duplicate/i.test(insertError.message);
    const capacityChanged = /segment_capacity_exceeded/i.test(insertError.message);
    const splitLocked = /fixed_total_split_locked/i.test(insertError.message);
    const distanceRejected = /(?:pickup|dropoff)_outside_ride_deviation|ride_route_unavailable/i.test(
      insertError.message
    );
    return NextResponse.json(
      {
        error: duplicate
          ? 'Ya tenés una reserva en este viaje.'
          : capacityChanged
            ? 'Los cupos de este tramo acaban de cambiar.'
            : splitLocked
              ? 'El reparto ya quedó fijado porque el viaje comenzó.'
              : distanceRejected
                ? 'El punto elegido supera el desvío permitido para este viaje.'
            : body.bookingId
              ? 'No se pudo actualizar la reserva.'
              : 'No se pudo crear la reserva.',
        code: duplicate
          ? 'DUPLICATE_BOOKING'
          : capacityChanged
            ? 'SEGMENT_CAPACITY_EXCEEDED'
            : splitLocked
              ? 'FIXED_TOTAL_SPLIT_LOCKED'
              : distanceRejected
                ? 'ROUTE_NO_LONGER_MATCHES'
            : 'BOOKING_FAILED',
      },
      { status: duplicate || capacityChanged || splitLocked ? 409 : 500 }
    );
  }
  return NextResponse.json({ booking }, { status: body.bookingId ? 200 : 201 });
}
