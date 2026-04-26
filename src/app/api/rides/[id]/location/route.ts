import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Máximo 1 request cada 5 s por (usuario, viaje) para tracking más fluido. */
const LOCATION_WINDOW_MS = 5_000;
const LOCATION_MAX_PER_WINDOW = 1;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

/** El conductor envía su posición durante el viaje (status en_route). */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rideId = params.id;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();

    const supabase = token
      ? createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
      : null;

    const {
      data: { user },
      error: authError,
    } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: { message: 'missing token' } as any };

    if (authError || !user || !supabase) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
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
      console.error('[ride-location] update error:', updateError.message);
      return NextResponse.json({ error: 'No se pudo actualizar la ubicación del conductor.' }, { status: 400 });
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
