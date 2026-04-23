import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { requireDriverOwnsRide } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPassengersRideEnRoutePush } from '@/lib/push/sendPassengersRideEnRoutePush';
import { sendPassengersRideCancelledPush } from '@/lib/push/sendPassengersRideCancelledPush';

const RIDE_STATUSES = ['draft', 'published', 'booked', 'en_route', 'completed', 'cancelled'] as const;
const updateStatusSchema = z.object({
  status: z.enum(RIDE_STATUSES),
});

const UPDATE_STATUS_WINDOW_MS = 60_000;
const UPDATE_STATUS_MAX_PER_WINDOW = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const hasAuthHeader = !!(request.headers.get('authorization') ?? request.headers.get('Authorization'));
    if (process.env.NODE_ENV === 'development') {
      console.log('[update-status] AUTH_DEBUG', { hasAuthorizationHeader: hasAuthHeader });
      console.log('[update-status] AUTH DEBUG HEADERS', {
        authHeader: headers().get('authorization') ?? headers().get('Authorization'),
        cookies: cookies().getAll(),
      });
    }
    const auth = await requireDriverOwnsRide(params.id, request);
    if (auth instanceof NextResponse) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[update-status] AUTH_DEBUG', { result: '401_or_403', status: auth.status });
      }
      return auth;
    }
    const { user, supabase } = auth;
    const service = createServiceClient();
    if (process.env.NODE_ENV === 'development') {
      console.log('[update-status] AUTH_DEBUG', { userId: user.id, email: user.email });
    }
    const rideId = params.id;

    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`update-status:${clientId}`, UPDATE_STATUS_WINDOW_MS, UPDATE_STATUS_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas actualizaciones. Esperá un momento.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const validated = updateStatusSchema.parse(body);

    if (validated.status === 'en_route') {
      const { data: otherEnRoute } = await supabase
        .from('rides')
        .select('id')
        .eq('driver_id', user.id)
        .eq('status', 'en_route')
        .neq('id', rideId)
        .limit(1);
      if (otherEnRoute && otherEnRoute.length > 0) {
        return NextResponse.json(
          {
            error: 'already_has_active_ride',
            details: 'Ya tenés un viaje en curso. Finalizá ese viaje antes de iniciar otro.',
          },
          { status: 400 }
        );
      }
    }

    const { data: driverAccount } = await supabase
      .from('driver_accounts')
      .select('account_status')
      .eq('driver_id', user.id)
      .maybeSingle();
    if (driverAccount?.account_status === 'suspended') {
      return NextResponse.json(
        {
          error: 'account_suspended',
          details: 'Tu cuenta está suspendida por deuda pendiente. Contactá a soporte para regularizar.',
        },
        { status: 403 }
      );
    }

    const updatePayload: Record<string, unknown> = { status: validated.status };
    if (validated.status === 'en_route') {
      updatePayload.started_at = new Date().toISOString();
      updatePayload.current_stop_index = 0;
      updatePayload.awaiting_stop_confirmation = false;
    }
    if (validated.status === 'completed') {
      updatePayload.driver_lat = null;
      updatePayload.driver_lng = null;
      updatePayload.driver_location_updated_at = null;
    }
    /**
     * Si el viaje viene de un grupo de demanda, "cancelar" lo devuelve a despacho del sistema:
     * awaiting_driver + sin conductor asignado (evita pérdida del grupo y permite retomar).
     */
    if (validated.status === 'cancelled') {
      const { data: groupRow } = await service
        .from('demand_route_groups')
        .select('id')
        .eq('ride_id', rideId)
        .maybeSingle();
      let isGroupedRide = Boolean(groupRow?.id);
      if (!isGroupedRide) {
        const { data: groupedTrips } = await service
          .from('trip_requests')
          .select('id')
          .eq('ride_id', rideId)
          .not('demand_group_id', 'is', null)
          .limit(1);
        isGroupedRide = Boolean(groupedTrips && groupedTrips.length > 0);
      }
      if (!isGroupedRide) {
        const { data: groupedByMembers } = await service
          .from('demand_route_members')
          .select('trip_request_id, trip_requests!inner(id, ride_id)')
          .eq('trip_requests.ride_id', rideId)
          .limit(1);
        isGroupedRide = Boolean(groupedByMembers && groupedByMembers.length > 0);
      }
      if (isGroupedRide) {
        updatePayload.status = 'awaiting_driver';
        updatePayload.driver_id = null;
        updatePayload.started_at = null;
        updatePayload.current_stop_index = 0;
        updatePayload.awaiting_stop_confirmation = false;
        updatePayload.driver_lat = null;
        updatePayload.driver_lng = null;
        updatePayload.driver_location_updated_at = null;
      }
    }

    const { data: updatedRide, error: updateError } = await service
      .from('rides')
      .update(updatePayload)
      .eq('id', rideId)
      .eq('driver_id', user.id)
      .select('id, status, driver_id')
      .maybeSingle();

    if (updateError || !updatedRide) {
      return NextResponse.json(
        { error: updateError?.message ?? 'No se pudo actualizar el viaje' },
        { status: 400 }
      );
    }

    /**
     * Tras cancelar un viaje de demanda agrupada, el ride vuelve a `awaiting_driver` con el mismo id.
     * Re-linkeamos `demand_route_groups.ride_id` desde los `trip_requests` para que listados / mapas
     * no queden apuntando a otro ride o sin vínculo (evita duplicados en UI y navegación al grupo equivocado).
     */
    if (validated.status === 'cancelled' && String(updatedRide.status) === 'awaiting_driver') {
      try {
        const { data: trOne } = await service
          .from('trip_requests')
          .select('demand_group_id')
          .eq('ride_id', rideId)
          .not('demand_group_id', 'is', null)
          .limit(1)
          .maybeSingle();
        const dg =
          trOne?.demand_group_id != null && String(trOne.demand_group_id).trim() !== ''
            ? String(trOne.demand_group_id).trim()
            : '';
        if (dg) {
          const { error: relErr } = await service
            .from('demand_route_groups')
            .update({ ride_id: rideId })
            .eq('id', dg);
          if (relErr) {
            console.warn('[update-status] demand_route_groups ride_id relink failed', relErr);
          }
        }
      } catch (e) {
        console.warn('[update-status] demand_route_groups ride_id relink', e);
      }
    }

    if (validated.status === 'en_route') {
      try {
        await sendPassengersRideEnRoutePush(service, rideId);
      } catch (e) {
        console.error('[update-status] passenger en_route push failed', e);
      }
    }
    if (validated.status === 'cancelled') {
      try {
        const nowIso = new Date().toISOString();
        await service
          .from('bookings')
          .update({ status: 'cancelled', updated_at: nowIso })
          .eq('ride_id', rideId)
          .neq('status', 'cancelled');
        await sendPassengersRideCancelledPush(service, rideId);
      } catch (e) {
        console.error('[update-status] passenger cancelled flow failed', e);
      }
    }

    return NextResponse.json({
      success: true,
      ride: {
        id: String(updatedRide.id),
        status: String(updatedRide.status),
        driver_id: updatedRide.driver_id,
      },
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
