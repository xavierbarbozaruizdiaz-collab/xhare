import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import type { RideStopForBookingLink } from '@/lib/booking-stop-link';
import {
  ARRIVE_GATE_M,
  canRegisterPassengerAction,
  driverNearArriveAnchor,
  dropoffDone,
  isBoarded,
  nearestPublishedStopOrder,
  pickupDecisionDone,
  primaryDropoffBookingsForVisit,
  primaryPickupBookingsForVisit,
  type ArriveVisitKind,
} from '@/lib/ride-arrive-visit';
import { isRouteAdjustmentStop, nextOperationalStopArrayIndex } from '@/lib/rideStopKinds';

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
  anchorLat: z.number().finite(),
  anchorLng: z.number().finite(),
  visitKind: z.enum(['pickup', 'dropoff', 'published']),
  visitBookingId: z.string().uuid().optional(),
});

const ARRIVE_WINDOW_MS = 60_000;
const ARRIVE_MAX_PER_WINDOW = 20;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

type BookingArriveRow = {
  id: string;
  status: string;
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
      return NextResponse.json(
        { error: 'Body inválido: stopOrder, anchor, visitKind y passengers requeridos' },
        { status: 400 }
      );
    }
    const {
      stopOrder,
      passengers,
      access_token: tokenFromBody,
      driverLat,
      driverLng,
      anchorLat,
      anchorLng,
      visitKind,
      visitBookingId,
    } = parsed.data;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const tokenFromHeader = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const tokenFromBodyClean = String(tokenFromBody ?? '').trim();
    const tokenCandidates = [tokenFromHeader, tokenFromBodyClean].filter(Boolean);

    if (tokenCandidates.length === 0) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    let userId = '';
    let authenticated = false;
    for (const token of tokenCandidates) {
      const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error: authError,
      } = await jwtClient.auth.getUser();
      if (!authError && user?.id) {
        userId = String(user.id);
        authenticated = true;
        break;
      }
    }
    if (!authenticated || !userId) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

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

    if (
      typeof driverLat === 'number' &&
      typeof driverLng === 'number' &&
      Number.isFinite(driverLat) &&
      Number.isFinite(driverLng)
    ) {
      if (!driverNearArriveAnchor(driverLat, driverLng, anchorLat, anchorLng, ARRIVE_GATE_M)) {
        return NextResponse.json(
          {
            error: `Acercate a menos de ${ARRIVE_GATE_M} m del punto para confirmar la llegada.`,
            code: 'driver_too_far_from_stop',
          },
          { status: 400 }
        );
      }
    }

    const { data: stops } = await service
      .from('ride_stops')
      .select('id, stop_order, lat, lng, label, is_base_stop')
      .eq('ride_id', rideId)
      .order('stop_order', { ascending: true });

    const sortedStops = Array.isArray(stops) ? stops : [];
    const linkStops: Array<RideStopForBookingLink & { stop_order: number; is_base_stop?: boolean | null }> =
      sortedStops
      .filter((s: { id: unknown; lat: unknown; lng: unknown }) => s.id != null)
      .map((s: { id: unknown; lat: unknown; lng: unknown; stop_order: unknown; is_base_stop?: unknown }) => ({
        id: String(s.id),
        lat: Number(s.lat),
        lng: Number(s.lng),
        stop_order: Number(s.stop_order),
        is_base_stop: s.is_base_stop === true ? true : s.is_base_stop === false ? false : null,
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.stop_order));

    const resolvedStopOrder =
      nearestPublishedStopOrder(linkStops, anchorLat, anchorLng) ?? stopOrder;

    const stopRow = sortedStops.find(
      (s: { stop_order: unknown }) => Number(s.stop_order) === resolvedStopOrder
    );
    if (!stopRow) {
      return NextResponse.json(
        { error: `No existe la parada con orden ${resolvedStopOrder} en este viaje.` },
        { status: 400 }
      );
    }

    const { data: rideBookings } = await service
      .from('bookings')
      .select(
        'id, status, pickup_stop_id, dropoff_stop_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng'
      )
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

    const { data: existingEventsRaw } = await service
      .from('ride_boarding_events')
      .select('booking_id, event_type')
      .eq('ride_id', rideId);

    const existingEvents = (existingEventsRaw ?? []).map((e: { booking_id: unknown; event_type: unknown }) => ({
      booking_id: String(e.booking_id),
      event_type: String(e.event_type),
    }));

    const vk = visitKind as ArriveVisitKind;

    if (vk === 'published' && isRouteAdjustmentStop(stopRow as { is_base_stop?: boolean | null })) {
      return NextResponse.json(
        { error: 'Los ajustes de ruta no son puntos de llegada. Usá el siguiente punto del recorrido.' },
        { status: 400 }
      );
    }

    const anchor = { lat: anchorLat, lng: anchorLng };
    const driverPoint =
      typeof driverLat === 'number' &&
      typeof driverLng === 'number' &&
      Number.isFinite(driverLat) &&
      Number.isFinite(driverLng)
        ? { lat: driverLat, lng: driverLng }
        : anchor;

    const primaryPickups = primaryPickupBookingsForVisit(
      bookingsForRide,
      existingEvents,
      visitBookingId
    );
    const primaryDropoffs = primaryDropoffBookingsForVisit(
      bookingsForRide,
      existingEvents,
      visitBookingId
    );
    const primaryPickupIds = new Set(primaryPickups.map((b) => b.id));
    const primaryDropoffIds = new Set(primaryDropoffs.map((b) => b.id));

    for (const p of passengers) {
      if (
        !canRegisterPassengerAction(
          bookingsForRide,
          existingEvents,
          driverPoint,
          p,
          primaryPickupIds,
          primaryDropoffIds,
          vk,
          visitBookingId,
          anchor,
          []
        )
      ) {
        return NextResponse.json(
          { error: 'Una de las acciones no corresponde a este punto o a la proximidad del minibús.' },
          { status: 400 }
        );
      }
      if (p.action === 'boarded' && isBoarded(existingEvents, p.id)) {
        return NextResponse.json({ error: 'Ese pasajero ya figura como subido.' }, { status: 400 });
      }
      if (p.action === 'no_show' && pickupDecisionDone(existingEvents, p.id)) {
        return NextResponse.json({ error: 'Ese pasajero ya tiene decisión de subida.' }, { status: 400 });
      }
      if (p.action === 'dropped_off' && dropoffDone(existingEvents, p.id)) {
        return NextResponse.json({ error: 'Ese pasajero ya figura como bajado.' }, { status: 400 });
      }
    }

    if (passengers.length > 0) {
      const { data: dupEvents } = await service
        .from('ride_boarding_events')
        .select('booking_id, event_type')
        .eq('ride_id', rideId)
        .in(
          'booking_id',
          passengers.map((p) => p.id)
        );

      for (const p of passengers) {
        const dup = (dupEvents ?? []).find(
          (e: { booking_id: unknown; event_type: unknown }) =>
            String(e.booking_id) === p.id && String(e.event_type) === p.action
        );
        if (dup) {
          return NextResponse.json(
            { error: 'Ya hay un evento registrado para uno de los pasajeros. No se puede duplicar.' },
            { status: 400 }
          );
        }
      }
    }

    const eventStopIndex = resolvedStopOrder;

    if (vk === 'published') {
      const { error: stopError } = await service
        .from('ride_stops')
        .update({ arrived_at: new Date().toISOString() })
        .eq('ride_id', rideId)
        .eq('stop_order', resolvedStopOrder);

      if (stopError) {
        console.error('[arrive] stop update error:', stopError.message);
        return NextResponse.json({ error: 'No se pudo registrar la llegada a la parada.' }, { status: 400 });
      }
    }

    for (const p of passengers) {
      const { error: insertErr } = await service.from('ride_boarding_events').insert({
        ride_id: rideId,
        booking_id: p.id,
        stop_index: eventStopIndex,
        event_type: p.action,
      });
      if (insertErr && insertErr.code !== '23505') {
        console.error('[arrive] boarding event insert error:', insertErr.message);
        return NextResponse.json(
          { error: 'No se pudo registrar uno de los eventos de abordaje.' },
          { status: 400 }
        );
      }
    }

    const visitActed = visitBookingId
      ? passengers.some((p) => p.id === visitBookingId)
      : false;
    if (
      visitBookingId &&
      !visitActed &&
      (vk === 'pickup' || vk === 'dropoff') &&
      validBookingIds.has(visitBookingId)
    ) {
      const b = bookingsForRide.find((x) => x.id === visitBookingId);
      const mayAckPickup =
        vk === 'pickup' && b && !pickupDecisionDone(existingEvents, visitBookingId);
      const mayAckDropoff =
        vk === 'dropoff' &&
        b &&
        isBoarded(existingEvents, visitBookingId) &&
        !dropoffDone(existingEvents, visitBookingId);
      if (mayAckPickup || mayAckDropoff) {
        const { error: ackErr } = await service.from('ride_boarding_events').insert({
          ride_id: rideId,
          booking_id: visitBookingId,
          stop_index: eventStopIndex,
          event_type: 'stop_visited',
        });
        if (ackErr && ackErr.code !== '23505') {
          console.error('[arrive] stop_visited insert error:', ackErr.message);
          return NextResponse.json(
            { error: 'No se pudo registrar el paso por este punto.' },
            { status: 400 }
          );
        }
      }
    }

    const so = Number(resolvedStopOrder);
    const currentIdx = sortedStops.findIndex((s: { stop_order: unknown }) => Number(s.stop_order) === so);
    let nextStopIndex = ride.current_stop_index ?? 0;
    let nextStop: (typeof sortedStops)[0] | null = null;

    if (vk === 'published') {
      const fromIdx = currentIdx >= 0 ? currentIdx : Math.max(0, (ride.current_stop_index ?? 0) - 1);
      nextStopIndex = nextOperationalStopArrayIndex(
        sortedStops as Array<{ is_base_stop?: boolean | null }>,
        fromIdx
      );
      nextStop = sortedStops[nextStopIndex] ?? null;
    }

    const { data: updatedRide, error: rideUpdateErr } = await service
      .from('rides')
      .update({
        awaiting_stop_confirmation: false,
        ...(vk === 'published' ? { current_stop_index: nextStopIndex } : {}),
      })
      .eq('id', rideId)
      .select('current_stop_index')
      .maybeSingle();

    if (rideUpdateErr) {
      console.error('[arrive] ride update error:', rideUpdateErr.message);
      return NextResponse.json({ error: 'No se pudo actualizar el estado del viaje.' }, { status: 400 });
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
