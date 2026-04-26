import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const assignDriverSchema = z.object({
  driver_id: z.string().uuid(),
});
const ADMIN_ASSIGN_DRIVER_WINDOW_MS = 60_000;
const ADMIN_ASSIGN_DRIVER_MAX_PER_WINDOW = 20;

function getJwtFromRequest(request: NextRequest): string | null {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return request.headers.get('x-admin-token')?.trim() ?? null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jwt = getJwtFromRequest(request);
    const supabaseAuth = createServerClient(request);

    let user: { id: string } | null = null;
    let authError: Error | null = null;
    if (jwt) {
      const res = await supabaseAuth.auth.getUser(jwt);
      user = res.data.user ?? null;
      authError = res.error ?? null;
    }
    if (!user) {
      const res = await supabaseAuth.auth.getUser();
      user = res.data.user ?? null;
      authError = res.error ?? null;
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`admin-assign-driver:${clientId}`, ADMIN_ASSIGN_DRIVER_WINDOW_MS, ADMIN_ASSIGN_DRIVER_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
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
      console.error('[admin/rides/assign-driver] update error:', updateError.message);
      return NextResponse.json(
        { error: 'No se pudo asignar el conductor al viaje.' },
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
    console.error('[admin/rides/assign-driver] unexpected:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

