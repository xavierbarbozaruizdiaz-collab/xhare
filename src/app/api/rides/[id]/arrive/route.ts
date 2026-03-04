import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const passengerActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['boarded', 'no_show', 'dropped_off']),
});

const bodySchema = z.object({
  stopOrder: z.number().int().min(0),
  passengers: z.array(passengerActionSchema),
});

const ARRIVE_WINDOW_MS = 60_000;
const ARRIVE_MAX_PER_WINDOW = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient(request);
    const rideId = params.id;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();

    const {
      data: { user },
      error: authError,
    } = token ? await supabase.auth.getUser(token) : { data: { user: null }, error: { message: 'missing token' } as any };

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`arrive:${clientId}`, ARRIVE_WINDOW_MS, ARRIVE_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const { data: ride } = await supabase
      .from('rides')
      .select('id, driver_id, status, current_stop_index')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== user.id) {
      return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        { error: 'Solo podés registrar llegada cuando el viaje está en curso' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { stopOrder, passengers } = bodySchema.parse(body);

    // Validar que la parada existe en este viaje
    const { data: stopRow } = await supabase
      .from('ride_stops')
      .select('id')
      .eq('ride_id', rideId)
      .eq('stop_order', stopOrder)
      .maybeSingle();

    if (!stopRow) {
      return NextResponse.json(
        { error: `No existe la parada con orden ${stopOrder} en este viaje.` },
        { status: 400 }
      );
    }

    // Validar que cada pasajero (booking_id) pertenece a este viaje y no está cancelado
    const { data: rideBookings } = await supabase
      .from('bookings')
      .select('id')
      .eq('ride_id', rideId)
      .neq('status', 'cancelled');

    const validBookingIds = new Set((rideBookings ?? []).map((b: { id: string }) => b.id));
    for (const p of passengers) {
      if (!validBookingIds.has(p.id)) {
        return NextResponse.json(
          { error: `La reserva ${p.id} no pertenece a este viaje o está cancelada.` },
          { status: 400 }
        );
      }
    }

    // Evitar evento duplicado o contradictorio: mismo (ride, booking, stop) ya tiene un evento
    if (passengers.length > 0) {
      const { data: existingEvents } = await supabase
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

    // Marcar arrived_at en ride_stops para esta parada
    const { error: stopError } = await supabase
      .from('ride_stops')
      .update({ arrived_at: new Date().toISOString() })
      .eq('ride_id', rideId)
      .eq('stop_order', stopOrder);

    if (stopError) {
      return NextResponse.json({ error: stopError.message }, { status: 400 });
    }

    // Insertar eventos de subida/bajada (id = booking_id)
    for (const p of passengers) {
      const { error: insertErr } = await supabase.from('ride_boarding_events').insert({
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

    const { data: stops } = await supabase
      .from('ride_stops')
      .select('id, stop_order, lat, lng, label')
      .eq('ride_id', rideId)
      .order('stop_order', { ascending: true });

    const sortedStops = Array.isArray(stops) ? stops : [];
    const currentIdx = sortedStops.findIndex((s: { stop_order: number }) => s.stop_order === stopOrder);
    const nextStopIndex = currentIdx >= 0 ? currentIdx + 1 : (ride.current_stop_index ?? 0) + 1;
    const nextStop = sortedStops[nextStopIndex] ?? null;

    const { error: rideUpdateErr } = await supabase
      .from('rides')
      .update({
        awaiting_stop_confirmation: false,
        current_stop_index: nextStopIndex,
      })
      .eq('id', rideId);

    if (rideUpdateErr) {
      return NextResponse.json({ error: rideUpdateErr.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
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
