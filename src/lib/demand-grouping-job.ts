import type { SupabaseClient } from '@supabase/supabase-js';
import { drainDriverDemandPassengerLeftPushQueue } from '@/lib/push/sendDriverDemandPassengerLeftPush';
import {
  type DemandGroupingMode,
  type DemandGroupingParams,
  runDemandGroupingPipeline,
} from '@/lib/demand-grouping-pipeline';

export type DemandGroupingTriggerSource = 'cron_get' | 'cron_post' | 'manual';

export type DemandGroupingJobStep = { name: string; status: number; body: unknown };

export type DemandGroupingJobResult = {
  ok: boolean;
  ranAt: string;
  mode: DemandGroupingMode;
  params: DemandGroupingParams;
  engine: string;
  runId: string | null;
  steps: DemandGroupingJobStep[];
  httpStatus: number;
};

function extractHexCounters(steps: DemandGroupingJobStep[]): {
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

/**
 * Misma corrida que GET/POST `/api/cron/demand-grouping` (pipeline HEX + cola push).
 * `trigger_source` debe cumplir el CHECK de `demand_grouping_runs` (incluye `manual` para admin).
 */
export async function executeDemandGroupingJob(
  service: SupabaseClient,
  triggerSource: DemandGroupingTriggerSource,
  mode: DemandGroupingMode,
  params: DemandGroupingParams
): Promise<DemandGroupingJobResult> {
  const startedAt = new Date();
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
    console.error('[demand-grouping-job] drainDriverDemandPassengerLeftPushQueue', e);
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

  return {
    ok: !anyFail,
    ranAt: new Date().toISOString(),
    mode,
    params,
    engine: 'hex_only',
    runId,
    steps,
    httpStatus,
  };
}
