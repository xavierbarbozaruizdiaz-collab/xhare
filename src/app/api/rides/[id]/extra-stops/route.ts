import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jwtDecode } from 'jwt-decode';
import { createServiceClient } from '@/lib/supabase/server';

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

type JwtPayload = { sub?: string; user_id?: string };

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
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim() || tokenFromBody || '';

    if (!token) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    let userId: string | null = null;
    try {
      const payload = jwtDecode<JwtPayload>(token);
      userId = payload.sub ?? payload.user_id ?? null;
    } catch {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
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
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
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
      return NextResponse.json({ error: insertError.message }, { status: 400 });
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

