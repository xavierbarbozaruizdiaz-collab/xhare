import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { detachTripRequestFromDemandGroup } from '@/lib/trip-request-favorite-ungroup';
import { sendDriverDemandPassengerLeftPush } from '@/lib/push/sendDriverDemandPassengerLeftPush';

/**
 * POST /api/trip-requests/[id]/leave-demand-group
 * Pasajero sale de la demanda agrupada (misma semántica que confirm_leave_group al guardar favorito).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth(request);
    if (auth instanceof NextResponse) return auth;

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
    const msg = e instanceof Error ? e.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
