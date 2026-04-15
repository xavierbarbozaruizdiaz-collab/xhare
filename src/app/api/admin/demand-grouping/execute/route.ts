import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runDemandRoutesGeoSync } from '@/lib/demand-routes-geo-sync';
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
      const maxSeats = Number.isFinite(body.maxSeats as number) ? Math.max(1, Math.floor(body.maxSeats as number)) : 15;
      const minScore = Number.isFinite(body.minScore as number) ? Math.max(0, Math.min(0.99, Number(body.minScore))) : 0.55;
      const maxOriginKm = Number.isFinite(body.maxOriginKm as number) ? Math.max(0.05, Number(body.maxOriginKm)) : 8;
      const maxDestKm = Number.isFinite(body.maxDestKm as number) ? Math.max(0.05, Number(body.maxDestKm)) : 8;

      const service = createServiceClient();
      const steps: Array<{ name: string; status: number; body: unknown }> = [];

      if (mode === 'both' || mode === 'classified') {
        const { data, error } = await service.rpc('auto_group_classified_trip_requests_v2', {
          p_max_seats: maxSeats,
          p_min_score: minScore,
          p_max_origin_km: maxOriginKm,
          p_max_dest_km: maxDestKm,
        });
        if (error) {
          const { data: fbData, error: fbErr } = await service.rpc('auto_group_classified_trip_requests', {
            p_max_seats: maxSeats,
          });
          if (fbErr) {
            steps.push({
              name: 'auto_group_classified_trip_requests_v2',
              status: 500,
              body: {
                error: error.message,
                code: error.code,
                fallback_error: fbErr.message,
                hint: 'Aplicá migración 075 para motor scored v2.',
              },
            });
          } else {
            steps.push({
              name: 'auto_group_classified_trip_requests (fallback_v1)',
              status: 200,
              body: fbData ?? { ok: true, fallback: true },
            });
          }
        } else {
          steps.push({
            name: 'auto_group_classified_trip_requests_v2',
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
        params: { maxSeats, minScore, maxOriginKm, maxDestKm },
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
