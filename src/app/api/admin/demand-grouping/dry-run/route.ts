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

/**
 * POST /api/admin/demand-grouping/dry-run
 * Simula sync geo sin escribir en base (sí puede llamar OSRM para polilíneas faltantes).
 * El RPC classified no tiene dry-run en Postgres: solo nota informativa.
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

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        geo: {
          ...geo,
          ...(capped ? { planned: capped.planned, planned_truncated: capped.truncated } : {}),
        },
        classified: {
          dry_run_available: false,
          note:
            'auto_group_classified_trip_requests es RPC en Postgres; no se simula aquí para no duplicar lógica. Usá diagnostics ?explain=1 (classified_ready) y luego ejecutá solo «Corredor+bucket» si querés aplicar.',
        },
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
