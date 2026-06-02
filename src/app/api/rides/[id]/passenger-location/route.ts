import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const LOCATION_WINDOW_MS = 5_000;
const LOCATION_MAX_PER_WINDOW = 1;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

/** El pasajero envía su posición mientras el viaje está en curso y aún no subió. */
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
    } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: { message: 'missing token' } as Error };

    if (authError || !user || !supabase) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    const locationKey = `passenger-location:${user.id}:${rideId}`;
    if (!checkRateLimit(locationKey, LOCATION_WINDOW_MS, LOCATION_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Esperá unos segundos antes de enviar de nuevo la ubicación.' },
        { status: 429 }
      );
    }

    const { data: ride } = await supabase.from('rides').select('id, status').eq('id', rideId).single();

    if (!ride) {
      return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        { error: 'Solo podés compartir ubicación cuando el viaje está en curso' },
        { status: 400 }
      );
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, status, passenger_id')
      .eq('ride_id', rideId)
      .eq('passenger_id', user.id)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (!booking) {
      return NextResponse.json({ error: 'No tenés una reserva activa en este viaje' }, { status: 404 });
    }

    const bst = String(booking.status ?? '');
    if (bst !== 'pending' && bst !== 'confirmed') {
      return NextResponse.json({ error: 'La reserva no permite compartir ubicación' }, { status: 400 });
    }

    const { data: boarded } = await supabase
      .from('ride_boarding_events')
      .select('id')
      .eq('ride_id', rideId)
      .eq('booking_id', booking.id)
      .eq('event_type', 'boarded')
      .limit(1);

    if (boarded && boarded.length > 0) {
      return NextResponse.json(
        { error: 'Ya registraste la subida; no hace falta seguir compartiendo ubicación' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validated = locationSchema.parse(body);

    const service = createServiceClient();
    const { error: updateError } = await service
      .from('bookings')
      .update({
        passenger_lat: validated.lat,
        passenger_lng: validated.lng,
        passenger_location_updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)
      .eq('passenger_id', user.id);

    if (updateError) {
      console.error('[passenger-location] update error:', updateError.message);
      return NextResponse.json({ error: 'No se pudo actualizar tu ubicación.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors?.[0]?.message ?? 'Invalid body' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
