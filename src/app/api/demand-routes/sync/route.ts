import { NextResponse } from 'next/server';
import { authGetUser, createServerClient } from '@/lib/supabase/server';

/**
 * POST /api/demand-routes/sync
 * Endpoint legado: geo_sync deshabilitado. Se mantiene como noop para compatibilidad.
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
        return NextResponse.json({ error: 'Solo conductor o admin pueden ejecutar sync' }, { status: 403 });
      }
    }

    return NextResponse.json({
      ok: true,
      deprecated: true,
      engine: 'geo_sync',
      status: 'disabled',
      message: 'geo_sync está deshabilitado; el pipeline opera en HEX-only.',
      processed: 0,
      addedToExisting: 0,
      newGroupsCreated: 0,
    });
  } catch (e) {
    console.error('demand-routes sync error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
