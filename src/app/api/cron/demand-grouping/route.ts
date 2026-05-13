import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeDemandGroupingParams } from '@/lib/demand-grouping-pipeline';
import { executeDemandGroupingJob, type DemandGroupingTriggerSource } from '@/lib/demand-grouping-job';

export const dynamic = 'force-dynamic';

function inferTriggerSource(request: NextRequest): DemandGroupingTriggerSource {
  return request.method === 'POST' ? 'cron_post' : 'cron_get';
}

function cronAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  const syncSecret = process.env.DEMAND_ROUTES_SYNC_SECRET?.trim();
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  if (cronSecret && token === cronSecret) return true;
  if (syncSecret && token === syncSecret) return true;
  return false;
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const syncSecret = process.env.DEMAND_ROUTES_SYNC_SECRET?.trim();
  if (!cronSecret && !syncSecret) {
    return NextResponse.json(
      {
        error:
          'Falta CRON_SECRET o DEMAND_ROUTES_SYNC_SECRET: configurá al menos uno en Vercel para autenticar el cron.',
      },
      { status: 503 }
    );
  }

  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  if (request.method === 'POST') {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const mode = 'both' as const;
  const params = normalizeDemandGroupingParams({
    maxSeats: body.maxSeats as number | undefined,
    minScore: body.minScore as number | undefined,
    maxOriginKm: body.maxOriginKm as number | undefined,
    maxDestKm: body.maxDestKm as number | undefined,
  });

  const service = createServiceClient();
  const triggerSource = inferTriggerSource(request);
  const result = await executeDemandGroupingJob(service, triggerSource, mode, params);

  return NextResponse.json(
    {
      ok: result.ok,
      ranAt: result.ranAt,
      path: '/api/cron/demand-grouping',
      mode: result.mode,
      params: result.params,
      engine: result.engine,
      runId: result.runId,
      steps: result.steps,
    },
    { status: result.httpStatus }
  );
}

/** Vercel Cron invoca GET con `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  return handle(request);
}

/** POST permite body `{ mode, maxSeats, ... }` (mismo contrato que admin execute). */
export async function POST(request: NextRequest) {
  return handle(request);
}
