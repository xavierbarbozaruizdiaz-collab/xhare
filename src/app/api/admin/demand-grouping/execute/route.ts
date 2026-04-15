import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runDemandRoutesGeoSync } from '@/lib/demand-routes-geo-sync';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-execute';

type Body = { mode?: 'both' | 'classified' | 'geo' };

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

      const service = createServiceClient();
      const steps: Array<{ name: string; status: number; body: unknown }> = [];

      if (mode === 'both' || mode === 'classified') {
        const { data, error } = await service.rpc('auto_group_classified_trip_requests', {
          p_max_seats: 15,
        });
        if (error) {
          steps.push({
            name: 'auto_group_classified_trip_requests',
            status: 500,
            body: { error: error.message, code: error.code },
          });
        } else {
          steps.push({
            name: 'auto_group_classified_trip_requests',
            status: 200,
            body: data ?? { ok: true },
          });
        }
      }

      if (mode === 'both' || mode === 'geo') {
        const geo = await runDemandRoutesGeoSync(service);
        if (!geo.ok) {
          steps.push({
            name: 'demand_routes_geo_sync',
            status: 500,
            body: { error: geo.error },
          });
        } else {
          steps.push({
            name: 'demand_routes_geo_sync',
            status: 200,
            body: {
              ok: true,
              processed: geo.processed,
              addedToExisting: geo.addedToExisting,
              newGroupsCreated: geo.newGroupsCreated,
              ...(geo.message ? { message: geo.message } : {}),
            },
          });
        }
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        mode,
        engine: 'in_process_service_role',
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
