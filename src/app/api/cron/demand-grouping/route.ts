import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { drainDriverDemandPassengerLeftPushQueue } from '@/lib/push/sendDriverDemandPassengerLeftPush';
import {
  normalizeDemandGroupingParams,
  runDemandGroupingPipeline,
} from '@/lib/demand-grouping-pipeline';

export const dynamic = 'force-dynamic';

function inferTriggerSource(request: NextRequest): 'cron_get' | 'cron_post' {
  return request.method === 'POST' ? 'cron_post' : 'cron_get';
}

function extractHexCounters(steps: Array<{ name: string; body: unknown }>): {
  tripRequestsGrouped: number;
  groupsCreated: number;
  groupsMerged: number;
} {
  const hexStep = steps.find((s) => s.name === 'auto_group_hex_trip_requests_v3');
  const body = (hexStep?.body ?? {}) as Record<string, unknown>;
  const tripRequestsGrouped = Number(body.trip_requests_grouped ?? 0);
  const groupsCreated = Number(body.groups_created ?? 0);
  const groupsMerged = Number(body.groups_merged ?? 0);
  return {
    tripRequestsGrouped: Number.isFinite(tripRequestsGrouped) ? tripRequestsGrouped : 0,
    groupsCreated: Number.isFinite(groupsCreated) ? groupsCreated : 0,
    groupsMerged: Number.isFinite(groupsMerged) ? groupsMerged : 0,
  };
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

  const mode = 'both';
  const params = normalizeDemandGroupingParams({
    maxSeats: body.maxSeats as number | undefined,
    minScore: body.minScore as number | undefined,
    maxOriginKm: body.maxOriginKm as number | undefined,
    maxDestKm: body.maxDestKm as number | undefined,
  });

  const service = createServiceClient();
  const startedAt = new Date();
  const triggerSource = inferTriggerSource(request);
  let runId: string | null = null;
  {
    const { data: runRow } = await service
      .from('demand_grouping_runs')
      .insert({
        trigger_source: triggerSource,
        engine_mode: 'hex_only',
        status: 'running',
        started_at: startedAt.toISOString(),
        params,
      })
      .select('id')
      .single();
    runId = runRow?.id ?? null;
  }
  try {
    await drainDriverDemandPassengerLeftPushQueue(service);
  } catch (e) {
    console.error('[cron/demand-grouping] drainDriverDemandPassengerLeftPushQueue', e);
  }
  const { steps } = await runDemandGroupingPipeline(service, mode, params);
  const anyFail = steps.some((s) => s.status >= 400);
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  const { tripRequestsGrouped, groupsCreated, groupsMerged } = extractHexCounters(steps);
  const httpStatus = anyFail ? 500 : 200;
  if (runId) {
    const firstErrorStep = steps.find((s) => s.status >= 400);
    const firstError = (firstErrorStep?.body ?? {}) as Record<string, unknown>;
    const errorMessage =
      firstError && typeof firstError.error === 'string'
        ? firstError.error
        : firstErrorStep
          ? `Paso fallido: ${firstErrorStep.name}`
          : null;
    await service
      .from('demand_grouping_runs')
      .update({
        status: anyFail ? 'error' : 'ok',
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        http_status: httpStatus,
        steps,
        trip_requests_grouped: tripRequestsGrouped,
        groups_created: groupsCreated,
        groups_merged: groupsMerged,
        error_message: errorMessage,
      })
      .eq('id', runId);
  }

  return NextResponse.json(
    {
      ok: !anyFail,
      ranAt: new Date().toISOString(),
      path: '/api/cron/demand-grouping',
      mode,
      params,
      engine: 'hex_only',
      runId,
      steps,
    },
    { status: httpStatus }
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
