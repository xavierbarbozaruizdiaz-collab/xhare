import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';

const assignDriverSchema = z.object({
  driver_id: z.string().uuid(),
});

function getJwtFromRequest(request: NextRequest): string | null {
  const raw =
    request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jwt = getJwtFromRequest(request);
    if (!jwt) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(jwt);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = createServiceClient();
    const { data: profile } = await service
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rideId = params.id;
    const body = await request.json();
    const validated = assignDriverSchema.parse(body);

    const { data: driverProfile } = await service
      .from('profiles')
      .select('*')
      .eq('id', validated.driver_id)
      .eq('role', 'driver')
      .single();

    if (!driverProfile) {
      return NextResponse.json(
        { error: 'Driver not found' },
        { status: 404 }
      );
    }

    const { data: ride, error: rideError } = await service
      .from('rides')
      .select('id, status')
      .eq('id', rideId)
      .single();

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 });
    }

    const notAssignable = ['en_route', 'completed', 'cancelled'];
    if (notAssignable.includes(ride.status)) {
      return NextResponse.json(
        { error: `No se puede asignar conductor: el viaje está ${ride.status}. Solo se puede asignar cuando el viaje está publicado.` },
        { status: 400 }
      );
    }

    if (ride.status !== 'published') {
      return NextResponse.json(
        { error: 'Solo se puede asignar conductor a un viaje con estado "published".' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await service
      .from('rides')
      .update({ driver_id: validated.driver_id })
      .eq('id', rideId)
      .eq('status', 'published')
      .select('id')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 400 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'No se pudo actualizar el viaje. El estado pudo haber cambiado.' },
        { status: 400 }
      );
    }

    await service.from('audit_events').insert({
      actor_id: user.id,
      entity_type: 'ride',
      entity_id: rideId,
      event_type: 'driver_assigned',
      payload: { driver_id: validated.driver_id },
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

