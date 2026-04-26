import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const extraStopSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().optional().nullable(),
  order: z.number().int().min(1).max(3),
});

const bodySchema = z.object({
  stops: z.array(extraStopSchema).max(3),
  access_token: z.string().optional(),
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';
const EXTRA_STOPS_WINDOW_MS = 60_000;
const EXTRA_STOPS_MAX_PER_WINDOW = 24;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const service = createServiceClient();
    const rideId = params.id;

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Body inválido: stops requerido (máx. 3 paradas)' }, { status: 400 });
    }

    const { stops, access_token: tokenFromBody } = parsed.data;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const tokenFromHeader = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const tokenFromBodyClean = String(tokenFromBody ?? '').trim();
    const tokenCandidates = Array.from(new Set([tokenFromHeader, tokenFromBodyClean].filter(Boolean)));

    if (tokenCandidates.length === 0) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    let userId = '';
    let authenticated = false;
    for (const token of tokenCandidates) {
      const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error: authError,
      } = await jwtClient.auth.getUser();
      if (!authError && user?.id) {
        userId = String(user.id);
        authenticated = true;
        break;
      }
    }
    if (!authenticated || !userId) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }
    const clientId = getClientId(request, userId);
    if (!checkRateLimit(`extra-stops:${rideId}:${clientId}`, EXTRA_STOPS_WINDOW_MS, EXTRA_STOPS_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    // Verificar que el usuario tiene una reserva activa en este viaje
    const { data: booking } = await service
      .from('bookings')
      .select('id, passenger_id, status')
      .eq('ride_id', rideId)
      .eq('passenger_id', userId)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (!booking) {
      return NextResponse.json(
        { error: 'No tenés una reserva activa en este viaje.' },
        { status: 403 }
      );
    }

    // Opcional: acá se podría validar que cada parada esté dentro de un desvío razonable de la ruta base
    // usando la polyline del viaje y un helper tipo getPositionAlongPolyline.

    // Estrategia sencilla: reemplazar el set completo de paradas extra del pasajero en este viaje.
    const { error: deleteError } = await service
      .from('passenger_extra_stops')
      .delete()
      .eq('ride_id', rideId)
      .eq('passenger_id', userId);

    if (deleteError) {
      console.error('[extra-stops] delete error:', deleteError.message);
      return NextResponse.json({ error: 'No se pudieron actualizar las paradas extra.' }, { status: 400 });
    }

    if (stops.length === 0) {
      return NextResponse.json({ success: true, stops: [] });
    }

    const rows = stops.map((s) => ({
      ride_id: rideId,
      passenger_id: userId,
      lat: s.lat,
      lng: s.lng,
      label: s.label ?? null,
      stop_order: s.order,
    }));

    const { data: inserted, error: insertError } = await service
      .from('passenger_extra_stops')
      .insert(rows)
      .select('id, ride_id, passenger_id, lat, lng, label, stop_order')
      .order('stop_order', { ascending: true });

    if (insertError) {
      console.error('[extra-stops] insert error:', insertError.message);
      return NextResponse.json({ error: 'No se pudieron guardar las paradas extra.' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      stops: inserted ?? [],
    });
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

