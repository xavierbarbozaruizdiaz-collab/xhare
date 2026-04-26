import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDriverOwnsRide } from '@/lib/api-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const bodySchema = z.object({
  bookingId: z.string().uuid(),
});
const CONFIRM_PAYMENT_WINDOW_MS = 60_000;
const CONFIRM_PAYMENT_MAX_PER_WINDOW = 25;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireDriverOwnsRide(params.id, request);
    if (auth instanceof NextResponse) return auth;
    const { supabase, ride } = auth;
    const clientId = getClientId(request, auth.user.id);
    if (!checkRateLimit(`confirm-payment:${params.id}:${clientId}`, CONFIRM_PAYMENT_WINDOW_MS, CONFIRM_PAYMENT_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    if (ride.status !== 'en_route' && ride.status !== 'completed') {
      return NextResponse.json(
        { error: 'Solo se puede confirmar cobro durante o al finalizar el viaje.' },
        { status: 400 }
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Body inválido: bookingId requerido.' }, { status: 400 });
    }
    const bookingId = parsed.data.bookingId;

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, ride_id, status, payment_status')
      .eq('id', bookingId)
      .eq('ride_id', params.id)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (!booking) {
      return NextResponse.json({ error: 'Reserva no encontrada para este viaje.' }, { status: 404 });
    }

    if (booking.payment_status === 'paid') {
      return NextResponse.json({ success: true, alreadyPaid: true });
    }

    const { error } = await supabase
      .from('bookings')
      .update({ payment_status: 'paid' })
      .eq('id', bookingId)
      .eq('ride_id', params.id);

    if (error) {
      console.error('[confirm-payment] update error:', error.message);
      return NextResponse.json({ error: 'No se pudo confirmar el cobro.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

