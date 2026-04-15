import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import type { GeoDryRunPlanned } from '@/lib/demand-routes-geo-sync';
import { runDemandRoutesGeoSync } from '@/lib/demand-routes-geo-sync';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-dry-run';

const MAX_APPEND = 150;
const MAX_POLY_UPDATES = 200;
const MAX_NEW_QUEUES = 60;
const MAX_CLASSIFIED_BATCHES = 80;

function capPlanned(p: GeoDryRunPlanned): { planned: GeoDryRunPlanned; truncated: boolean } {
  const over =
    p.append_to_existing.length > MAX_APPEND ||
    p.trip_polyline_updates.length > MAX_POLY_UPDATES ||
    p.new_group_queues.length > MAX_NEW_QUEUES;
  return {
    planned: {
      trip_polyline_updates: p.trip_polyline_updates.slice(0, MAX_POLY_UPDATES),
      append_to_existing: p.append_to_existing.slice(0, MAX_APPEND),
      new_group_queues: p.new_group_queues.slice(0, MAX_NEW_QUEUES),
    },
    truncated: over,
  };
}

function capClassifiedPreview(payload: unknown): { payload: unknown; batches_truncated: boolean } {
  if (!payload || typeof payload !== 'object') return { payload, batches_truncated: false };
  const o = payload as Record<string, unknown>;
  const batches = o.batches;
  if (!Array.isArray(batches) || batches.length <= MAX_CLASSIFIED_BATCHES) {
    return { payload, batches_truncated: false };
  }
  return {
    payload: {
      ...o,
      batches: batches.slice(0, MAX_CLASSIFIED_BATCHES),
      batches_truncated: true,
      batches_total: batches.length,
    },
    batches_truncated: true,
  };
}

/**
 * POST /api/admin/demand-grouping/dry-run
 * - Geo: misma lógica que sync sin escrituras en Supabase (puede llamar OSRM).
 * - Classified: RPC preview en Postgres (misma partición en lotes, sin INSERT/UPDATE) tras migración 070.
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const service = createServiceClient();
      const geo = await runDemandRoutesGeoSync(service, { dryRun: true });
      if (!geo.ok) {
        return NextResponse.json({ error: geo.error }, { status: 500 });
      }

      const capped = geo.planned ? capPlanned(geo.planned) : null;

      const { data: classifiedRaw, error: classifiedErr } = await service.rpc(
        'auto_group_classified_trip_requests_preview',
        { p_max_seats: 15 }
      );

      let classified: Record<string, unknown>;
      if (classifiedErr) {
        classified = {
          dry_run_available: false,
          error: classifiedErr.message,
          hint: 'Aplicá en Supabase la migración 070_auto_group_classified_trip_requests_preview.sql para habilitar el preview del RPC classified.',
        };
      } else {
        const cappedCls = capClassifiedPreview(classifiedRaw);
        classified = {
          dry_run_available: true,
          preview: cappedCls.payload,
          ...(cappedCls.batches_truncated ? { preview_batches_truncated: true } : {}),
        };
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        geo: {
          ...geo,
          ...(capped ? { planned: capped.planned, planned_truncated: capped.truncated } : {}),
        },
        classified,
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
