import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-diagnostics';

/**
 * GET /api/admin/demand-grouping/diagnostics
 * Diagnóstico HEX-only para panel admin.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (_req) => {
    try {
      const service = createServiceClient();
      const notes: string[] = ['Motores corridor/classified y geo_sync deshabilitados en runtime.'];

      const { count: pendingTotal, error: pendingErr } = await service
        .from('trip_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (pendingErr) notes.push(`pending total: ${pendingErr.message}`);

      const { count: pendingHexReady, error: hexErr } = await service
        .from('trip_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .not('origin_super_hex', 'is', null)
        .not('dest_super_hex', 'is', null);
      if (hexErr) notes.push(`pending hex-ready: ${hexErr.message}`);

      const { count: pendingWithoutHex, error: noHexErr } = await service
        .from('trip_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .or('origin_super_hex.is.null,dest_super_hex.is.null');
      if (noHexErr) notes.push(`pending sin hex: ${noHexErr.message}`);

      const routingByEngine: Record<string, number | null> = {};
      for (const engine of ['hex', 'corridor', 'geo', 'unknown'] as const) {
        const { count, error } = await service
          .from('trip_requests')
          .select('*', { count: 'exact', head: true })
          .eq('routing_engine', engine);
        routingByEngine[engine] = error ? null : (count ?? 0);
        if (error) notes.push(`routing_engine.${engine}: ${error.message}`);
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

      const { data: recentRuns, error: runsErr } = await service
        .from('demand_grouping_runs')
        .select(
          'id, trigger_source, engine_mode, status, started_at, finished_at, duration_ms, trip_requests_grouped, groups_created, groups_merged, http_status, error_message'
        )
        .order('started_at', { ascending: false })
        .limit(10);
      if (runsErr) notes.push(`demand_grouping_runs: ${runsErr.message}`);
      const latestRun = Array.isArray(recentRuns) && recentRuns.length > 0 ? recentRuns[0] : null;

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        audit: {
          pipelines: ['HEX-only: auto_group_hex_trip_requests_v3 + optimización Google PDP.'],
          removed: ['corridor_bucket/classified', 'geo_sync'],
        },
        pendingTotal: pendingTotal ?? null,
        routingByEngine,
        pendingHexReadyCount: pendingHexReady ?? null,
        pendingWithoutHexCount: pendingWithoutHex ?? null,
        demandRouteGroupsTotal: groupsTotal ?? null,
        demandRouteGroupsRequestedDateGte7d: groupsLast7d ?? null,
        demandRouteMembersTotal: membersTotal ?? null,
        latestRun,
        recentRuns: recentRuns ?? [],
        notes,
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
