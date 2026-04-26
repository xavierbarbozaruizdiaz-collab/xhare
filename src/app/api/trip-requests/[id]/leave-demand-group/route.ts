import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { detachTripRequestFromDemandGroup } from '@/lib/trip-request-favorite-ungroup';
import { sendDriverDemandPassengerLeftPush } from '@/lib/push/sendDriverDemandPassengerLeftPush';
const LEAVE_DEMAND_GROUP_WINDOW_MS = 60_000;
const LEAVE_DEMAND_GROUP_MAX_PER_WINDOW = 20;

/**
 * POST /api/trip-requests/[id]/leave-demand-group
 * Pasajero sale de la demanda agrupada (JWT Next + service RPC + push inmediato).
 * La app móvil usa la RPC `detach_trip_request_from_demand_group_for_passenger` con la sesión de Supabase
 * para no depender de que Vercel comparta el mismo JWT; el push se encola y lo drena el cron / POST trip-requests.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth(request);
    if (auth instanceof NextResponse) return auth;
    const clientId = getClientId(request, auth.user.id);
    if (!checkRateLimit(`leave-demand-group:${clientId}`, LEAVE_DEMAND_GROUP_WINDOW_MS, LEAVE_DEMAND_GROUP_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const { id: tripRequestId } = await params;
    if (!tripRequestId?.trim()) {
      return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    }

    const service = createServiceClient();
    const detached = await detachTripRequestFromDemandGroup(service, {
      userId: auth.user.id,
      tripRequestId: tripRequestId.trim(),
    });

    if (!detached.ok) {
      if (detached.code === 'GROUP_HAS_ACTIVE_RIDE') {
        return NextResponse.json(
          { code: detached.code, error: detached.error },
          { status: 409 }
        );
      }
      if (detached.code === 'NOT_FOUND' || detached.code === 'INVALID_STATUS') {
        return NextResponse.json({ error: detached.error, code: detached.code }, { status: 400 });
      }
      return NextResponse.json({ error: detached.error }, { status: 400 });
    }

    void sendDriverDemandPassengerLeftPush(service, detached.notifyDriverRides);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[trip-requests/leave-demand-group] unexpected:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
