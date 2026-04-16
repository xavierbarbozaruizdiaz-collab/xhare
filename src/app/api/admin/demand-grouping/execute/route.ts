import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeDemandGroupingParams, runDemandGroupingPipeline } from '@/lib/demand-grouping-pipeline';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-execute';

type Body = {
  mode?: 'both' | 'classified' | 'geo';
  maxSeats?: number;
  minScore?: number;
  maxOriginKm?: number;
  maxDestKm?: number;
};

/**
 * POST /api/admin/demand-grouping/execute
 * body: { mode: "both" | "classified" | "geo" }
 * Orquestación en proceso (sin fetch al propio host): service role + mismas operaciones que los endpoints públicos.
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (req, _user) => {
    try {
      let body: Body = {};
      try {
        body = (await req.json()) as Body;
      } catch {
        body = {};
      }
      const mode = body.mode === 'classified' || body.mode === 'geo' ? body.mode : 'both';
      const params = normalizeDemandGroupingParams(body);

      const service = createServiceClient();
      const { steps } = await runDemandGroupingPipeline(service, mode, params);

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        mode,
        engine: 'in_process_service_role',
        params,
        steps,
        hint:
          'Ya no se reenvía HTTP al propio deploy: admin validado aquí y luego service role (igual que los endpoints originales tras auth).',
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Error interno' },
        { status: 500 }
      );
    }
  });
}
