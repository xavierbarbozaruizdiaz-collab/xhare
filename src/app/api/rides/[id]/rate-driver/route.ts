import { NextRequest, NextResponse } from 'next/server';
import { resolveBearerAuth } from '@/lib/supabase-bearer-user-from-tokens';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const bodySchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  access_token: z.string().optional(),
});

const RATE_DRIVER_WINDOW_MS = 60_000;
const RATE_DRIVER_MAX_PER_WINDOW = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rideId = params.id;
    const rawBody = await request.json();
    const auth = await resolveBearerAuth(request, rawBody);

    if (!auth) {
      return NextResponse.json(
        { error: 'Sesión inválida o expirada. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    const { user, supabase } = auth;

    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`rate-driver:${clientId}`, RATE_DRIVER_WINDOW_MS, RATE_DRIVER_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const { stars, comment } = bodySchema.parse(rawBody);

    const { data: ride } = await supabase
      .from('rides')
      .select('id, driver_id')
      .eq('id', rideId)
      .single();

    if (!ride || !ride.driver_id) {
      return NextResponse.json({ error: 'Ride not found' }, { status: 404 });
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .eq('ride_id', rideId)
      .eq('passenger_id', user.id)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (!booking) {
      return NextResponse.json(
        { error: 'Solo podés calificar al chofer si tenés una reserva en este viaje' },
        { status: 403 }
      );
    }

    const { data: existing } = await supabase
      .from('driver_ratings')
      .select('id')
      .eq('ride_id', rideId)
      .eq('passenger_id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Already rated' },
        { status: 409 }
      );
    }

    const { error: insertError } = await supabase.from('driver_ratings').insert({
      ride_id: rideId,
      driver_id: ride.driver_id,
      passenger_id: user.id,
      stars,
      ...(comment ? { comment } : {}),
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'Already rated' },
          { status: 409 }
        );
      }
      console.error('[rate-driver] insert error:', insertError.message);
      return NextResponse.json({ error: 'No se pudo guardar la calificación del conductor.' }, { status: 400 });
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
