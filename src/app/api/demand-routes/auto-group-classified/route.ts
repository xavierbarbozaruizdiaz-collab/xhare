import { NextResponse } from 'next/server';
import { authGetUser, createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/demand-routes/auto-group-classified
 * Endpoint legado: corridor/classified deshabilitado. Se mantiene como noop para compatibilidad.
 * Auth: conductor/admin o Bearer DEMAND_ROUTES_SYNC_SECRET.
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

    return NextResponse.json({
      ok: true,
      deprecated: true,
      engine: 'corridor_bucket/classified',
      status: 'disabled',
      message: 'auto-group-classified está deshabilitado; el pipeline opera en HEX-only.',
      steps: [],
    });
  } catch (e) {
    console.error('[auto-group-classified] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
