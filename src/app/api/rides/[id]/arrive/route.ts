import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import {
  bookingDropoffAtPublishedStop,
  bookingPickupAtPublishedStop,
  driverNearStopForArrive,
  type RideStopForBookingLink,
} from '@/lib/booking-stop-link';

const passengerActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['boarded', 'no_show', 'dropped_off']),
});

const bodySchema = z.object({
  stopOrder: z.number().int().min(0),
  passengers: z.array(passengerActionSchema),
  access_token: z.string().optional(),
  driverLat: z.number().finite().optional(),
  driverLng: z.number().finite().optional(),
});

const ARRIVE_WINDOW_MS = 60_000;
const ARRIVE_MAX_PER_WINDOW = 20;

type BookingArriveRow = {
  id: string;
  pickup_stop_id: string | null;
  dropoff_stop_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const service = createServiceClient();
    const rideId = params.id;

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Body inválido: stopOrder y passengers requeridos' }, { status: 400 });
    }
    const { stopOrder, passengers, access_token: tokenFromBody, driverLat, driverLng } = parsed.data;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim() || tokenFromBody || '';

    if (!token) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    const authClient = createServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }
    const userId = user.id;

    const clientId = getClientId(request, userId);
    if (!checkRateLimit(`arrive:${clientId}`, ARRIVE_WINDOW_MS, ARRIVE_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const { data: ride } = await service
      .from('rides')
      .select('id, driver_id, status, current_stop_index')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== userId) {
      return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        { error: 'Solo podés registrar llegada cuando el viaje está en curso' },
        { status: 400 }
      );
    }

    const { data: stops } = await service
      .from('ride_stops')
      .select('id, stop_order, lat, lng, label')
      .eq('ride_id', rideId)
      .order('stop_order', { ascending: true });

    const sortedStops = Array.isArray(stops) ? stops : [];

    const stopRow = sortedStops.find((s: { stop_order: unknown }) => Number(s.stop_order) === stopOrder);
    if (!stopRow) {
      return NextResponse.json(
        { error: `No existe la parada con orden ${stopOrder} en este viaje.` },
        { status: 400 }
      );
    }

    const slat = Number(stopRow.lat);
    const slng = Number(stopRow.lng);
    if (
      typeof driverLat === 'number' &&
      typeof driverLng === 'number' &&
      Number.isFinite(driverLat) &&
      Number.isFinite(driverLng)
    ) {
      if (!driverNearStopForArrive(driverLat, driverLng, slat, slng)) {
        return NextResponse.json(
          {
            error:
              'Parece que no estás lo suficientemente cerca de esta parada para confirmarla. Acercate al punto indicado o revisá que el GPS esté encendido.',
            code: 'driver_too_far_from_stop',
          },
          { status: 400 }
        );
      }
    }

    const linkStops: RideStopForBookingLink[] = sortedStops
      .filter((s: { id: unknown; lat: unknown; lng: unknown }) => s.id != null)
      .map((s: { id: unknown; lat: unknown; lng: unknown }) => ({
        id: String(s.id),
        lat: Number(s.lat),
        lng: Number(s.lng),
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

    const { data: rideBookings } = await service
      .from('bookings')
      .select('id, pickup_stop_id, dropoff_stop_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng')
      .eq('ride_id', rideId)
      .neq('status', 'cancelled');

    const bookingsForRide = (rideBookings ?? []) as BookingArriveRow[];
    const validBookingIds = new Set(bookingsForRide.map((b) => b.id));
    for (const p of passengers) {
      if (!validBookingIds.has(p.id)) {
        return NextResponse.json(
          { error: `La reserva ${p.id} no pertenece a este viaje o está cancelada.` },
          { status: 400 }
        );
      }
    }

    const sid = stopRow.id as string;
    const atStop = bookingsForRide.filter(
      (b) =>
        bookingPickupAtPublishedStop(b, sid, linkStops) || bookingDropoffAtPublishedStop(b, sid, linkStops)
    );

    if (passengers.length === 0) {
      if (atStop.length > 0) {
        return NextResponse.json(
          {
            error:
              'En esta parada hay subidas o bajadas de reservas. Registrá subió/no subió y bajada con cobro confirmado antes de continuar.',
          },
          { status: 400 }
        );
      }
    } else if (atStop.length > 0) {
      for (const b of atStop) {
        if (bookingPickupAtPublishedStop(b, sid, linkStops)) {
          const ok = passengers.some(
            (p) => p.id === b.id && (p.action === 'boarded' || p.action === 'no_show')
          );
          if (!ok) {
            return NextResponse.json(
              {
                error:
                  'Falta registrar la subida (subió o no subió) para cada reserva que sube en esta parada.',
              },
              { status: 400 }
            );
          }
        }
        if (bookingDropoffAtPublishedStop(b, sid, linkStops)) {
          const ok = passengers.some((p) => p.id === b.id && p.action === 'dropped_off');
          if (!ok) {
            return NextResponse.json(
              {
                error:
                  'Falta confirmar la bajada (y cobro, si corresponde) para cada reserva que baja en esta parada.',
              },
              { status: 400 }
            );
          }
        }
      }
      for (const p of passengers) {
        const row = atStop.find((x) => x.id === p.id);
        if (!row) {
          return NextResponse.json(
            { error: 'Cada acción debe ser de una reserva con subida o bajada en esta parada.' },
            { status: 400 }
          );
        }
        if (p.action === 'dropped_off') {
          if (!bookingDropoffAtPublishedStop(row, sid, linkStops)) {
            return NextResponse.json(
              { error: 'La bajada no corresponde a esta parada.' },
              { status: 400 }
            );
          }
        } else if (p.action === 'boarded' || p.action === 'no_show') {
          if (!bookingPickupAtPublishedStop(row, sid, linkStops)) {
            return NextResponse.json(
              { error: 'La subida no corresponde a esta parada.' },
              { status: 400 }
            );
          }
        }
      }
    }

    if (passengers.length > 0) {
      const { data: existingEvents } = await service
        .from('ride_boarding_events')
        .select('booking_id')
        .eq('ride_id', rideId)
        .eq('stop_index', stopOrder)
        .in('booking_id', passengers.map((p) => p.id));

      if (existingEvents && existingEvents.length > 0) {
        return NextResponse.json(
          { error: 'Ya hay un evento registrado para uno o más pasajeros en esta parada. No se puede duplicar.' },
          { status: 400 }
        );
      }
    }

    const { error: stopError } = await service
      .from('ride_stops')
      .update({ arrived_at: new Date().toISOString() })
      .eq('ride_id', rideId)
      .eq('stop_order', stopOrder);

    if (stopError) {
      return NextResponse.json({ error: stopError.message }, { status: 400 });
    }

    for (const p of passengers) {
      const { error: insertErr } = await service.from('ride_boarding_events').insert({
        ride_id: rideId,
        booking_id: p.id,
        stop_index: stopOrder,
        event_type: p.action,
      });
      if (insertErr && insertErr.code !== '23505') {
        return NextResponse.json(
          { error: `Error guardando evento: ${insertErr.message}` },
          { status: 400 }
        );
      }
    }

    const so = Number(stopOrder);
    const currentIdx = sortedStops.findIndex((s: { stop_order: unknown }) => Number(s.stop_order) === so);
    const nextStopIndex = currentIdx >= 0 ? currentIdx + 1 : (ride.current_stop_index ?? 0) + 1;
    const nextStop = sortedStops[nextStopIndex] ?? null;

    const { data: updatedRide, error: rideUpdateErr } = await service
      .from('rides')
      .update({
        awaiting_stop_confirmation: false,
        current_stop_index: nextStopIndex,
      })
      .eq('id', rideId)
      .select('current_stop_index')
      .maybeSingle();

    if (rideUpdateErr) {
      return NextResponse.json({ error: rideUpdateErr.message }, { status: 400 });
    }
    if (!updatedRide) {
      return NextResponse.json({ error: 'No se pudo actualizar el viaje.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      current_stop_index: updatedRide.current_stop_index,
      nextStop: nextStop
        ? { stop_order: nextStop.stop_order, lat: nextStop.lat, lng: nextStop.lng, label: nextStop.label }
        : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
