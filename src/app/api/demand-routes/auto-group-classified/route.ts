import { NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/demand-routes/auto-group-classified
 * Agrupa trip_requests pending + classified por (corridor_id, time_bucket) en demand_route_groups/members.
 * Misma autorización que sync: conductor/admin o Bearer DEMAND_ROUTES_SYNC_SECRET.
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    const cronSecret = process.env.DEMAND_ROUTES_SYNC_SECRET;
    const useCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

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
      if (!profile || !['driver', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Solo conductor o admin pueden ejecutar agrupación' }, { status: 403 });
      }
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('auto_group_classified_trip_requests', {
      p_max_seats: 15,
    });

    if (error) {
      console.error('[auto-group-classified] rpc error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payload = data as Record<string, unknown> | null;
    if (process.env.NODE_ENV !== 'production') {
      console.info('[classification] auto_group_classified', payload);
    }

    return NextResponse.json(payload ?? { ok: false });
  } catch (e) {
    console.error('[auto-group-classified] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
