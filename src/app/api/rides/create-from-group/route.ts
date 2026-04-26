import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const bodySchema = z.object({
  group_id: z.string().uuid(),
});
const CREATE_FROM_GROUP_WINDOW_MS = 60_000;
const CREATE_FROM_GROUP_MAX_PER_WINDOW = 30;

/**
 * POST /api/rides/create-from-group
 * Crea un `ride` en estado `awaiting_driver` desde `demand_route_groups`, vincula `trip_requests` → accepted.
 * Auth: admin JWT o Authorization: Bearer DEMAND_ROUTES_SYNC_SECRET (mismo criterio operativo que sync / auto-group).
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    const cronSecret = process.env.DEMAND_ROUTES_SYNC_SECRET;
    const useCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
    const cronClientId = getClientId(request, 'cron');

    if (!useCron) {
      const server = createServerClient(request);
      const {
        data: { user },
        error: authError,
      } = await authGetUser(server, request);
      if (authError || !user) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
      const { data: profile } = await server.from('profiles').select('role').eq('id', user.id).single();
      if (!profile || profile.role !== 'admin') {
        return NextResponse.json(
          { error: 'Solo administradores pueden despachar grupos a viaje (o usá el secret de sync en Authorization).' },
          { status: 403 }
        );
      }
      const userClientId = getClientId(request, user.id);
      if (!checkRateLimit(`create-from-group:${userClientId}`, CREATE_FROM_GROUP_WINDOW_MS, CREATE_FROM_GROUP_MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }
    } else if (!checkRateLimit(`create-from-group:${cronClientId}`, CREATE_FROM_GROUP_WINDOW_MS, CREATE_FROM_GROUP_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body: { "group_id": "<uuid>" }', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('create_ride_from_demand_group', {
      p_group_id: parsed.data.group_id,
    });

    if (error) {
      console.error('[create-from-group] rpc error:', error.message);
      return NextResponse.json({ error: 'No se pudo crear el viaje desde el grupo.' }, { status: 400 });
    }

    const out = data as Record<string, unknown> | null;
    if (process.env.NODE_ENV !== 'production') {
      console.info('[create-from-group]', out);
    }

    const rideId = out?.ride_id;
    return NextResponse.json({
      ...out,
      ride_id: rideId,
    });
  } catch (e) {
    console.error('[create-from-group]', e);
    return NextResponse.json(
      { error: 'Error interno' },
      { status: 500 }
    );
  }
}
