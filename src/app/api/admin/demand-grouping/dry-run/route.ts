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
      let reqBody: Record<string, unknown> = {};
      try {
        reqBody = (await request.json()) as Record<string, unknown>;
      } catch {
        reqBody = {};
      }
      const maxSeats = Number.isFinite(reqBody.maxSeats as number) ? Math.max(1, Math.floor(reqBody.maxSeats as number)) : 15;
      const minScore = Number.isFinite(reqBody.minScore as number) ? Math.max(0, Math.min(0.99, Number(reqBody.minScore))) : 0.55;
      const maxOriginKm = Number.isFinite(reqBody.maxOriginKm as number) ? Math.max(0.05, Number(reqBody.maxOriginKm)) : 8;
      const maxDestKm = Number.isFinite(reqBody.maxDestKm as number) ? Math.max(0.05, Number(reqBody.maxDestKm)) : 8;
      const geo = await runDemandRoutesGeoSync(service, { dryRun: true });
      if (!geo.ok) {
        return NextResponse.json({ error: geo.error }, { status: 500 });
      }

      const capped = geo.planned ? capPlanned(geo.planned) : null;

      let classifiedRaw: unknown = null;
      let classifiedErr: { message: string } | null = null;
      {
        const v2 = await service.rpc('auto_group_classified_trip_requests_preview_v2', {
          p_max_seats: maxSeats,
          p_min_score: minScore,
          p_max_origin_km: maxOriginKm,
          p_max_dest_km: maxDestKm,
        });
        if (!v2.error) {
          classifiedRaw = v2.data;
        } else {
          const v1 = await service.rpc('auto_group_classified_trip_requests_preview', {
            p_max_seats: maxSeats,
          });
          classifiedRaw = v1.data;
          classifiedErr = v1.error ? { message: `${v2.error.message}; fallback_v1: ${v1.error.message}` } : null;
          if (!v1.error && v2.error) {
            (classifiedRaw as Record<string, unknown>) = {
              ...(classifiedRaw as Record<string, unknown>),
              engine: 'fallback_v1',
              hint: 'Aplicá migración 075 para preview scored v2.',
            };
          }
        }
      }

      let classified: Record<string, unknown>;
      if (classifiedErr) {
        classified = {
          dry_run_available: false,
          error: classifiedErr.message,
          hint: 'Aplicá migraciones 070 y 075 para preview classified v2 completo.',
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
        params: { maxSeats, minScore, maxOriginKm, maxDestKm },
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
