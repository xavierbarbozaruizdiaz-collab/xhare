import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authGetUser, createServerClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const checkinSchema = z.object({
  request_id: z.string().uuid(),
  status: z.enum(['checked_in', 'no_show']),
});
const CHECKIN_WINDOW_MS = 60_000;
const CHECKIN_MAX_PER_WINDOW = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient(request);
    const rideId = params.id;

    const {
      data: { user },
      error: authError,
    } = await authGetUser(supabase, request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`ride-checkin:${rideId}:${clientId}`, CHECKIN_WINDOW_MS, CHECKIN_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment.' },
        { status: 429 }
      );
    }

    // Verify user is driver and owns this ride
    const { data: ride } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .eq('driver_id', user.id)
      .single();

    if (!ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 });
    }

    const body = await request.json();
    const validated = checkinSchema.parse(body);

    // Update ride passenger status
    const { error: updateError } = await supabase
      .from('ride_passengers')
      .update({ status: validated.status })
      .eq('ride_id', rideId)
      .eq('request_id', validated.request_id);

    if (updateError) {
      console.error('[ride-checkin] update error:', updateError.message);
      return NextResponse.json(
        { error: 'No se pudo registrar el estado del pasajero.' },
        { status: 400 }
      );
    }

    // Log audit event
    await supabase.from('audit_events').insert({
      actor_id: user.id,
      entity_type: 'ride_passenger',
      entity_id: validated.request_id,
      event_type: `passenger_${validated.status}`,
      payload: { ride_id: rideId },
    });

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

