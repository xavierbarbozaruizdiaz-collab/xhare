import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-diagnostics';
const ADMIN_DEMAND_GROUPING_DIAGNOSTICS_WINDOW_MS = 60_000;
const ADMIN_DEMAND_GROUPING_DIAGNOSTICS_MAX_PER_WINDOW = 30;

/**
 * GET /api/admin/demand-grouping/diagnostics
 * Diagnóstico HEX-only para panel admin.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-demand-grouping-diagnostics:${clientId}`, ADMIN_DEMAND_GROUPING_DIAGNOSTICS_WINDOW_MS, ADMIN_DEMAND_GROUPING_DIAGNOSTICS_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
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

      const todayYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Asuncion',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const { count: enabledShortcutsAhead, error: shortcutErr } = await service
        .from('passenger_home_map_shortcuts')
        .select('*', { count: 'exact', head: true })
        .eq('enabled', true)
        .gte('scheduled_date', todayYmd);
      if (shortcutErr) notes.push(`atajos activos: ${shortcutErr.message}`);
      else {
        notes.push(
          'Al ejecutar agrupamiento se materializan atajos activos → trip_requests pending (paso materialize_shortcut_trip_requests).'
        );
      }

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
        enabledShortcutsScheduledFromToday: enabledShortcutsAhead ?? null,
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
