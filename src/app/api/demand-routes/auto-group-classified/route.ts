import { NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import { normalizeDemandGroupingParams, runDemandGroupingPipeline } from '@/lib/demand-grouping-pipeline';

export const dynamic = 'force-dynamic';

/**
 * POST /api/demand-routes/auto-group-classified
 * Solo paso classified: v2 (score) con fallback v1, mismos parámetros opcionales que admin/cron.
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

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const params = normalizeDemandGroupingParams({
      maxSeats: body.maxSeats as number | undefined,
      minScore: body.minScore as number | undefined,
      maxOriginKm: body.maxOriginKm as number | undefined,
      maxDestKm: body.maxDestKm as number | undefined,
    });

    const supabase = createServiceClient();
    const { steps } = await runDemandGroupingPipeline(supabase, 'classified', params);
    const step = steps[0];
    const ok = step?.status === 200;

    if (process.env.NODE_ENV !== 'production' && ok) {
      console.info('[classification] auto_group_classified pipeline', step?.body);
    }

    return NextResponse.json(
      { ok, steps, params },
      { status: ok ? 200 : 500 }
    );
  } catch (e) {
    console.error('[auto-group-classified] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
