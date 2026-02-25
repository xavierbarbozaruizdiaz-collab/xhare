import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const bodySchema = z.object({
  passengerId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
});

const RATE_PASSENGER_WINDOW_MS = 60_000;
const RATE_PASSENGER_MAX_PER_WINDOW = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient();
    const rideId = params.id;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`rate-passenger:${clientId}`, RATE_PASSENGER_WINDOW_MS, RATE_PASSENGER_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const { data: ride } = await supabase
      .from('rides')
      .select('id, driver_id')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== user.id) {
      return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
    }

    const body = await request.json();
    const { passengerId, stars } = bodySchema.parse(body);

    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .eq('ride_id', rideId)
      .eq('passenger_id', passengerId)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (!booking) {
      return NextResponse.json(
        { error: 'Ese pasajero no tiene reserva en este viaje' },
        { status: 403 }
      );
    }

    const { data: droppedEvent } = await supabase
      .from('ride_boarding_events')
      .select('id')
      .eq('ride_id', rideId)
      .eq('booking_id', booking.id)
      .eq('event_type', 'dropped_off')
      .maybeSingle();

    if (!droppedEvent) {
      return NextResponse.json(
        { error: 'Solo podés calificar a un pasajero después de que bajó' },
        { status: 403 }
      );
    }

    const { data: existing } = await supabase
      .from('passenger_ratings')
      .select('id')
      .eq('ride_id', rideId)
      .eq('passenger_id', passengerId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Already rated' },
        { status: 409 }
      );
    }

    const { error: insertError } = await supabase.from('passenger_ratings').insert({
      ride_id: rideId,
      driver_id: user.id,
      passenger_id: passengerId,
      stars,
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'Already rated' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
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
