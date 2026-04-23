import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-groups-list';

/**
 * GET /api/admin/demand-groups?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=300
 * Listado de `demand_route_groups` para el panel (service role tras admin).
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (req) => {
    try {
      const service = createServiceClient();
      const { searchParams } = new URL(req.url);
      const today = new Date().toISOString().slice(0, 10);
      const from = searchParams.get('from') ?? today;
      const toParam = searchParams.get('to');
      const fromD = new Date(from + 'T12:00:00');
      if (Number.isNaN(fromD.getTime())) {
        return NextResponse.json({ error: 'from inválido' }, { status: 400 });
      }
      const to =
        toParam ?? new Date(fromD.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const limit = Math.min(500, Math.max(1, Math.floor(Number(searchParams.get('limit') ?? '300') || 300)));

      const { data: rows, error } = await service
        .from('demand_route_groups')
        .select(
          'id, ride_id, base_trip_request_id, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, grouping_source, base_length_km, created_at'
        )
        .gte('requested_date', from)
        .lte('requested_date', to)
        .order('requested_date', { ascending: false })
        .order('requested_time', { ascending: false })
        .limit(limit);

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ from, to, limit, groups: rows ?? [] });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
