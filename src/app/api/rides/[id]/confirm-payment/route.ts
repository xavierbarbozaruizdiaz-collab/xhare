import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDriverOwnsRide } from '@/lib/api-auth';

const bodySchema = z.object({
  bookingId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireDriverOwnsRide(params.id, request);
    if (auth instanceof NextResponse) return auth;
    const { supabase, ride } = auth;

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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

