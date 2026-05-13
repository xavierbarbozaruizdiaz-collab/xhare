import { NextRequest, NextResponse } from 'next/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeDemandGroupingParams } from '@/lib/demand-grouping-pipeline';
import { executeDemandGroupingJob } from '@/lib/demand-grouping-job';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-execute';
/** Evita abuso: corrida pesada (RPC + Google pass). */
const ADMIN_DEMAND_GROUPING_EXECUTE_WINDOW_MS = 120_000;
const ADMIN_DEMAND_GROUPING_EXECUTE_MAX_PER_WINDOW = 4;

/**
 * POST /api/admin/demand-grouping/execute
 * Ejecuta el mismo pipeline que el cron (HEX-only), con JWT admin y rate limit.
 * Body opcional: `{ maxSeats?, minScore?, maxOriginKm?, maxDestKm? }` (igual que cron POST).
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (req, user) => {
    try {
      const clientId = getClientId(req, user.id);
      if (
        !checkRateLimit(
          `admin-demand-grouping-execute:${clientId}`,
          ADMIN_DEMAND_GROUPING_EXECUTE_WINDOW_MS,
          ADMIN_DEMAND_GROUPING_EXECUTE_MAX_PER_WINDOW
        )
      ) {
        return NextResponse.json({ error: 'Demasiadas ejecuciones. Esperá unos minutos.' }, { status: 429 });
      }

      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }

      const mode = 'both' as const;
      const params = normalizeDemandGroupingParams({
        maxSeats: body.maxSeats as number | undefined,
        minScore: body.minScore as number | undefined,
        maxOriginKm: body.maxOriginKm as number | undefined,
        maxDestKm: body.maxDestKm as number | undefined,
      });

      const service = createServiceClient();
      const result = await executeDemandGroupingJob(service, 'manual', mode, params);

      logBlockOk(BLOCK);
      return NextResponse.json(
        {
          ok: result.ok,
          ranAt: result.ranAt,
          path: '/api/admin/demand-grouping/execute',
          trigger: 'manual',
          mode: result.mode,
          params: result.params,
          engine: result.engine,
          runId: result.runId,
          steps: result.steps,
        },
        { status: result.httpStatus }
      );
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
