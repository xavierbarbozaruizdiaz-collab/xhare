import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Máximo 1 request cada 15 s por (usuario, viaje) para no saturar en producción. */
const LOCATION_WINDOW_MS = 15_000;
const LOCATION_MAX_PER_WINDOW = 1;

/** El conductor envía su posición durante el viaje (status en_route). */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient(request);
    const rideId = params.id;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();

    const {
      data: { user },
      error: authError,
    } = token ? await supabase.auth.getUser(token) : { data: { user: null }, error: { message: 'missing token' } as any };

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const locationKey = `location:${user.id}:${rideId}`;
    if (!checkRateLimit(locationKey, LOCATION_WINDOW_MS, LOCATION_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Esperá unos segundos antes de enviar de nuevo la ubicación.' },
        { status: 429 }
      );
    }

    const { data: ride } = await supabase
      .from('rides')
      .select('id, driver_id, status')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== user.id) {
      return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        { error: 'Solo podés enviar ubicación cuando el viaje está en curso' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validated = locationSchema.parse(body);

    const { error: updateError } = await supabase
      .from('rides')
      .update({
        driver_lat: validated.lat,
        driver_lng: validated.lng,
        driver_location_updated_at: new Date().toISOString(),
      })
      .eq('id', rideId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors?.[0]?.message ?? 'Invalid body' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
