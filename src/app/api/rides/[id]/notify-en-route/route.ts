import { NextRequest, NextResponse } from 'next/server';
import { requireDriverOwnsRide } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPassengersRideEnRoutePush } from '@/lib/push/sendPassengersRideEnRoutePush';

/**
 * Dispara push de inicio de trayecto (idempotente). Útil si el estado pasó a en_route
 * vía Supabase directo (fallback móvil) sin pasar por update-status.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireDriverOwnsRide(params.id, request);
    if (auth instanceof NextResponse) return auth;

    const service = createServiceClient();
    const sent = await sendPassengersRideEnRoutePush(service, params.id);
    return NextResponse.json({ success: true, sent });
  } catch (e) {
    console.error('[notify-en-route]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
