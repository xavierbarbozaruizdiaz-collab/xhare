import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';

const assignDriverSchema = z.object({
  driver_id: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient(request);
    const rideId = params.id;
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const {
      data: { user },
      error: authError,
    } = jwt ? await supabase.auth.getUser(jwt) : await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const validated = assignDriverSchema.parse(body);

    // Verify driver exists and is a driver
    const { data: driverProfile } = await supabase
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

    // Ride must exist and be in assignable state (published only)
    const { data: ride, error: rideError } = await supabase
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

    // Update ride: set driver_id, keep status published (driver asignado = published + driver_id)
    const { data: updated, error: updateError } = await supabase
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

    // Log audit event
    await supabase.from('audit_events').insert({
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

