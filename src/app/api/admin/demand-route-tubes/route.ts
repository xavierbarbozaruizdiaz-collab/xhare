import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import type { Point } from '@/types';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-route-tubes';
const DEMAND_ROUTE_TUBES_WINDOW_MS = 60_000;
const DEMAND_ROUTE_TUBES_MAX_PER_WINDOW = 40;

function parsePolyline(raw: unknown): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: Point[] = [];
  for (const p of raw) {
    if (!p) return null;
    if (Array.isArray(p) && p.length >= 2) {
      const lng = Number(p[0]);
      const lat = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      out.push({ lat, lng });
      continue;
    }
    if (typeof p === 'object') {
      const o = p as Record<string, unknown>;
      const lat = Number(o.lat);
      const lng = Number(o.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      out.push({ lat, lng });
      continue;
    }
    return null;
  }
  return out;
}

function straightLine(a: Point, b: Point): Point[] {
  return [a, b];
}

export type DemandTubeRow = {
  id: string;
  polyline: Point[];
  label: string;
  requested_date: string;
  passenger_count: number;
  /** true si el eje salió de trip_requests (fallback), no de base_polyline del grupo. */
  axis_fallback?: boolean;
};

/**
 * GET /api/admin/demand-route-tubes?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Grupos de demanda con polilínea para el tubo visual (~2 km al eje, mismo criterio que sync).
 * Si `base_polyline` no sirve, intenta `trip_requests.route_polyline` o recta origen→destino del pedido base.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-demand-route-tubes:${clientId}`, DEMAND_ROUTE_TUBES_WINDOW_MS, DEMAND_ROUTE_TUBES_MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }
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
        .select(
          'id, base_polyline, base_trip_request_id, origin_city, destination_city, requested_date, passenger_count'
        )
        .gte('requested_date', from)
        .lte('requested_date', to)
        .order('requested_date', { ascending: true })
        .limit(120);

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: 'No se pudieron obtener los tubos de demanda.' }, { status: 400 });
      }

      const rows = data ?? [];
      const tubes: DemandTubeRow[] = [];
      let fallbackCount = 0;

      for (const row of rows) {
        let poly = parsePolyline(row.base_polyline);
        let axisFallback = false;
        const baseId = row.base_trip_request_id as string | null | undefined;

        if ((!poly || poly.length < 2) && baseId) {
          const { data: tr } = await service
            .from('trip_requests')
            .select('route_polyline, origin_lat, origin_lng, destination_lat, destination_lng')
            .eq('id', baseId)
            .maybeSingle();
          if (tr) {
            const fromRoute = parsePolyline(tr.route_polyline);
            if (fromRoute && fromRoute.length >= 2) {
              poly = fromRoute;
              axisFallback = true;
            } else {
              const oLat = Number(tr.origin_lat);
              const oLng = Number(tr.origin_lng);
              const dLat = Number(tr.destination_lat);
              const dLng = Number(tr.destination_lng);
              if ([oLat, oLng, dLat, dLng].every(Number.isFinite)) {
                poly = straightLine({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng });
                axisFallback = true;
              }
            }
          }
        }

        if (!poly || poly.length < 2) continue;
        if (axisFallback) fallbackCount += 1;

        const oc = typeof row.origin_city === 'string' ? row.origin_city.trim() : '';
        const dc = typeof row.destination_city === 'string' ? row.destination_city.trim() : '';
        const label = [oc || 'Origen', dc || 'Destino'].filter(Boolean).join(' → ');
        tubes.push({
          id: String(row.id),
          polyline: poly,
          label: label || `Grupo ${String(row.id).slice(0, 8)}…`,
          requested_date: String(row.requested_date ?? ''),
          passenger_count: Number(row.passenger_count ?? 0) || 0,
          axis_fallback: axisFallback,
        });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        from,
        to,
        tubes,
        groups_in_range: rows.length,
        tubes_drawn: tubes.length,
        tubes_axis_fallback: fallbackCount,
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
