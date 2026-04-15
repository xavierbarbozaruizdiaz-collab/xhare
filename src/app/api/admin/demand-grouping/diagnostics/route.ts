import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { sampleClassifiedReadyExplain, sampleGeoUnassignedExplain } from '@/lib/demand-routes-geo-sync';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-diagnostics';

/** Estados de demanda alineados con mapa de despacho (referencia). */
const DEMAND_STATUSES = ['pending', 'grouping', 'grouped', 'group_linked_pending'] as const;

/**
 * GET /api/admin/demand-grouping/diagnostics
 * Lectura única para panel: conteos y señales de por qué no hay grupos/tubos.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (req) => {
    try {
      const service = createServiceClient();
      const { searchParams } = new URL(req.url);
      const withExplain = searchParams.get('explain') === '1';
      const notes: string[] = [];

      const byStatus: Record<string, number | null> = {};
      for (const st of DEMAND_STATUSES) {
        const { count, error } = await service
          .from('trip_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', st);
        byStatus[st] = error ? null : (count ?? 0);
        if (error) notes.push(`trip_requests.${st}: ${error.message}`);
      }

      const { count: pendingTotal, error: e1 } = await service
        .from('trip_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (e1) notes.push(`pending total: ${e1.message}`);

      let geoEligibleHead: number | null = null;
      let geoEligibleErr: string | null = null;
      {
        const { count, error } = await service
          .from('trip_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
          .or('classification_status.is.null,classification_status.eq.unclassified')
          .not('origin_lat', 'is', null)
          .not('origin_lng', 'is', null)
          .not('destination_lat', 'is', null)
          .not('destination_lng', 'is', null);
        if (error) {
          geoEligibleErr = error.message;
          notes.push(
            `Filtro geo (pending + sin clasificar + coords): ${error.message} — ¿falta migración de classification_status?`
          );
        } else {
          geoEligibleHead = count ?? 0;
        }
      }

      let classifiedReadyHead: number | null = null;
      let classifiedReadyErr: string | null = null;
      {
        const { count, error } = await service
          .from('trip_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('classification_status', 'classified')
          .not('corridor_id', 'is', null)
          .not('time_bucket', 'is', null);
        if (error) {
          classifiedReadyErr = error.message;
          notes.push(`Filtro classified+corredor+bucket: ${error.message}`);
        } else {
          classifiedReadyHead = count ?? 0;
        }
      }

      let classifiedPendingNoCorridor: number | null = null;
      {
        const { count, error } = await service
          .from('trip_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('classification_status', 'classified')
          .is('corridor_id', null);
        if (!error) classifiedPendingNoCorridor = count ?? 0;
      }

      const { count: groupsTotal } = await service
        .from('demand_route_groups')
        .select('*', { count: 'exact', head: true });
      const { count: membersTotal } = await service
        .from('demand_route_members')
        .select('*', { count: 'exact', head: true });

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoYmd = weekAgo.toISOString().slice(0, 10);
      const { count: groupsLast7d } = await service
        .from('demand_route_groups')
        .select('*', { count: 'exact', head: true })
        .gte('requested_date', weekAgoYmd);

      let unassignedGeoSample = 0;
      let unassignedGeoSampleCap = 0;
      if (geoEligibleHead != null && geoEligibleHead > 0 && !geoEligibleErr) {
        const cap = 3000;
        const { data: cand, error: cErr } = await service
          .from('trip_requests')
          .select('id')
          .eq('status', 'pending')
          .or('classification_status.is.null,classification_status.eq.unclassified')
          .not('origin_lat', 'is', null)
          .not('destination_lat', 'is', null)
          .limit(cap);
        if (!cErr && cand?.length) {
          unassignedGeoSampleCap = cand.length;
          const ids = cand.map((r) => r.id);
          const { data: mems, error: mErr } = await service
            .from('demand_route_members')
            .select('trip_request_id')
            .in('trip_request_id', ids);
          if (!mErr && mems) {
            const set = new Set(mems.map((m) => m.trip_request_id));
            unassignedGeoSample = ids.filter((id) => !set.has(id)).length;
          }
        }
      }

      let explain_samples: Record<string, unknown> | undefined;
      if (withExplain) {
        const [geoEx, classifiedEx] = await Promise.all([
          sampleGeoUnassignedExplain(service),
          sampleClassifiedReadyExplain(service),
        ]);
        explain_samples = {
          geo: geoEx,
          classified_ready: classifiedEx,
          note:
            'Geo: blocking_hints salen de escanear grupos existentes (misma lógica que sync). classified_ready: filas que el RPC puede agrupar si corrés «Corredor+bucket».',
        };
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        explain: withExplain,
        audit: {
          pipelines: [
            'Geo sync: POST /api/demand-routes/sync — pending + (classification null o unclassified) + coords; excluye ya en demand_route_members.',
            'Corredor+bucket: POST /api/demand-routes/auto-group-classified — RPC auto_group_classified_trip_requests; preview sin escribir: auto_group_classified_trip_requests_preview (migr. 070).',
          ],
          tubes:
            'Los tubos admin leen demand_route_groups con polilínea usable. Sin grupos en rango → sin tubo violeta (no es fallo del dibujo).',
        },
        tripRequestsByStatus: byStatus,
        pendingTotal: pendingTotal ?? null,
        geoSyncEligibleCount: geoEligibleHead,
        geoSyncEligibleError: geoEligibleErr,
        geoUnassignedInSample:
          unassignedGeoSampleCap > 0
            ? {
                unassigned: unassignedGeoSample,
                sampleSize: unassignedGeoSampleCap,
                note:
                  unassignedGeoSampleCap >= 3000
                    ? 'Muestra hasta 3000 ids; el total real puede ser mayor.'
                    : 'Muestra completa dentro del límite.',
              }
            : null,
        classifiedPipelineReadyCount: classifiedReadyHead,
        classifiedPipelineError: classifiedReadyErr,
        classifiedButPendingNoCorridorCount: classifiedPendingNoCorridor,
        demandRouteGroupsTotal: groupsTotal ?? null,
        demandRouteGroupsRequestedDateGte7d: groupsLast7d ?? null,
        demandRouteMembersTotal: membersTotal ?? null,
        notes,
        ...(explain_samples ? { explain_samples } : {}),
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
