import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const ADMIN_FORCE_COMPLETE_WINDOW_MS = 60_000;
const ADMIN_FORCE_COMPLETE_MAX_PER_WINDOW = 30;

function getJwtFromRequest(request: NextRequest): string | null {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return request.headers.get('x-admin-token')?.trim() ?? null;
}

/**
 * Admin: cierra un viaje que quedó en `en_route` (conductor no finalizó).
 * Misma limpieza de ubicación que POST /api/rides/[id]/update-status → completed.
 * Las reservas se sincronizan vía trigger `sync_bookings_on_ride_status_change`.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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
    if (
      !checkRateLimit(
        `admin-force-complete:${clientId}`,
        ADMIN_FORCE_COMPLETE_WINDOW_MS,
        ADMIN_FORCE_COMPLETE_MAX_PER_WINDOW
      )
    ) {
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

    const { data: ride, error: rideError } = await service
      .from('rides')
      .select('id, status')
      .eq('id', rideId)
      .maybeSingle();

    if (rideError || !ride) {
      return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        {
          error: 'invalid_status',
          details: `Solo se puede forzar el cierre cuando el viaje está en curso (en_route). Estado actual: ${ride.status}.`,
        },
        { status: 400 }
      );
    }

    const updatePayload = {
      status: 'completed' as const,
      driver_lat: null,
      driver_lng: null,
      driver_location_updated_at: null,
      awaiting_stop_confirmation: false,
    };

    const { data: updated, error: updateError } = await service
      .from('rides')
      .update(updatePayload)
      .eq('id', rideId)
      .eq('status', 'en_route')
      .select('id, status')
      .maybeSingle();

    if (updateError || !updated) {
      return NextResponse.json(
        {
          error: updateError?.message ?? 'No se pudo actualizar el viaje (el estado pudo haber cambiado).',
        },
        { status: 400 }
      );
    }

    await service.from('audit_events').insert({
      actor_id: user.id,
      entity_type: 'ride',
      entity_id: rideId,
      event_type: 'ride_force_completed',
      payload: { previous_status: 'en_route' },
    });

    return NextResponse.json({
      success: true,
      ride: { id: String(updated.id), status: String(updated.status) },
    });
  } catch (error) {
    console.error('[admin/rides/force-complete] unexpected:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
