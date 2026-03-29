import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { requireDriverOwnsRide } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPassengersRideEnRoutePush } from '@/lib/push/sendPassengersRideEnRoutePush';

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

    const { error: updateError } = await supabase
      .from('rides')
      .update(updatePayload)
      .eq('id', rideId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    if (validated.status === 'en_route') {
      try {
        const service = createServiceClient();
        await sendPassengersRideEnRoutePush(service, rideId);
      } catch (e) {
        console.error('[update-status] passenger en_route push failed', e);
      }
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
