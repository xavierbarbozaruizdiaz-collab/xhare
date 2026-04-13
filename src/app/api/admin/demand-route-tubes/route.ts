import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import type { Point } from '@/types';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-route-tubes';

function parsePolyline(raw: unknown): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: Point[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    out.push({ lat, lng });
  }
  return out;
}

export type DemandTubeRow = {
  id: string;
  polyline: Point[];
  label: string;
  requested_date: string;
  passenger_count: number;
};

/**
 * GET /api/admin/demand-route-tubes?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Grupos de demanda (geo_sync) con polilínea base para dibujar el “tubo” de 2 km del sync.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const service = createServiceClient();
      const { searchParams } = new URL(request.url);
      const today = new Date().toISOString().slice(0, 10);
      const from = searchParams.get('from') ?? today;
      const toParam = searchParams.get('to');
      const toDate = new Date(from + 'T12:00:00');
      if (Number.isNaN(toDate.getTime())) {
        return NextResponse.json({ error: 'from inválido' }, { status: 400 });
      }
      const to =
        toParam ??
        new Date(toDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const { data, error } = await service
        .from('demand_route_groups')
        .select('id, base_polyline, origin_city, destination_city, requested_date, passenger_count')
        .gte('requested_date', from)
        .lte('requested_date', to)
        .order('requested_date', { ascending: true })
        .limit(80);

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const tubes: DemandTubeRow[] = [];
      for (const row of data ?? []) {
        const poly = parsePolyline(row.base_polyline);
        if (!poly) continue;
        const oc = typeof row.origin_city === 'string' ? row.origin_city.trim() : '';
        const dc = typeof row.destination_city === 'string' ? row.destination_city.trim() : '';
        const label = [oc || 'Origen', dc || 'Destino'].filter(Boolean).join(' → ');
        tubes.push({
          id: String(row.id),
          polyline: poly,
          label: label || `Grupo ${String(row.id).slice(0, 8)}…`,
          requested_date: String(row.requested_date ?? ''),
          passenger_count: Number(row.passenger_count ?? 0) || 0,
        });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ from, to, tubes });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
