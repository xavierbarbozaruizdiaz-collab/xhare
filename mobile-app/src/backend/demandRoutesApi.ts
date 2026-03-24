/**
 * Rutas con demanda agrupadas: listado y detalle para conductor y pasajero.
 * Listado: lectura directa en Supabase (RLS permite SELECT en demand_route_groups).
 * Detalle: intenta Next.js GET /api/demand-routes/[id] (todos los puntos vía service role);
 * si falla la API, fallback en Supabase (RLS: conductores ven pending; pasajeros pueden ver subset).
 * Sync: POST /api/demand-routes/sync (sigue requiriendo API + JWT válido).
 */
import { apiGet, apiPost } from './api';
import { supabase, isEnvConfigured } from './supabase';
import { env } from '../core/env';
import { raceWithTimeout } from './withTimeout';

const SUPABASE_QUERY_TIMEOUT_MS = 28_000;

function getBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

export type DemandRouteGroup = {
  id: string;
  base_trip_request_id: string | null;
  base_polyline: Array<{ lat: number; lng: number }>;
  base_length_km: number;
  requested_date: string;
  requested_time: string;
  origin_city: string | null;
  origin_barrio: string | null;
  destination_city: string | null;
  destination_barrio: string | null;
  passenger_count: number;
  created_at?: string;
};

export type DemandRouteDetail = DemandRouteGroup & {
  base_trip_request_id?: string | null;
  passengers: Array<{
    trip_request_id: string;
    origin_lat: number;
    origin_lng: number;
    origin_label: string | null;
    destination_lat: number;
    destination_lng: number;
    destination_label: string | null;
  }>;
};

function parsePolyline(raw: unknown): Array<{ lat: number; lng: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ lat: number; lng: number }> = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && 'lat' in p && 'lng' in p) {
      const lat = Number((p as { lat: unknown }).lat);
      const lng = Number((p as { lng: unknown }).lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
  }
  return out;
}

function mapGroupRow(row: Record<string, unknown>): DemandRouteGroup {
  return {
    id: String(row.id),
    base_trip_request_id: row.base_trip_request_id != null ? String(row.base_trip_request_id) : null,
    base_polyline: parsePolyline(row.base_polyline),
    base_length_km: Number(row.base_length_km ?? 0),
    requested_date: String(row.requested_date ?? ''),
    requested_time: String(row.requested_time ?? ''),
    origin_city: row.origin_city != null ? String(row.origin_city) : null,
    origin_barrio: row.origin_barrio != null ? String(row.origin_barrio) : null,
    destination_city: row.destination_city != null ? String(row.destination_city) : null,
    destination_barrio: row.destination_barrio != null ? String(row.destination_barrio) : null,
    passenger_count: Number(row.passenger_count ?? 0),
    created_at: row.created_at != null ? String(row.created_at) : undefined,
  };
}

export async function fetchDemandRoutes(params?: {
  origin_city?: string;
  destination_city?: string;
  requested_date_from?: string;
  requested_date_to?: string;
}): Promise<{ groups: DemandRouteGroup[]; error?: string }> {
  if (!isEnvConfigured()) {
    return { groups: [], error: 'Supabase no configurado en la app' };
  }

  let q = supabase
    .from('demand_route_groups')
    .select(
      'id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, created_at'
    )
    .order('requested_date', { ascending: true })
    .order('requested_time', { ascending: true });

  if (params?.origin_city) q = q.ilike('origin_city', `%${params.origin_city}%`);
  if (params?.destination_city) q = q.ilike('destination_city', `%${params.destination_city}%`);
  if (params?.requested_date_from) q = q.gte('requested_date', params.requested_date_from);
  if (params?.requested_date_to) q = q.lte('requested_date', params.requested_date_to);

  const groupsQuery = q;
  const { data, error } = await raceWithTimeout(
    groupsQuery,
    SUPABASE_QUERY_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: {
          message:
            'Tiempo de espera al cargar rutas con demanda. Revisá conexión, VPN o que Supabase responda.',
        },
      }) as Awaited<typeof groupsQuery>
  );
  if (error) return { groups: [], error: error.message };
  return { groups: (data ?? []).map((row) => mapGroupRow(row as Record<string, unknown>)) };
}

async function fetchDemandRouteDetailFromSupabase(
  groupId: string
): Promise<{ detail: DemandRouteDetail | null; error?: string }> {
  if (!isEnvConfigured()) {
    return { detail: null, error: 'Supabase no configurado' };
  }

  return raceWithTimeout(
    (async (): Promise<{ detail: DemandRouteDetail | null; error?: string }> => {
  const { data: row, error: gErr } = await supabase
    .from('demand_route_groups')
    .select(
      'id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, created_at'
    )
    .eq('id', groupId)
    .maybeSingle();

  if (gErr) return { detail: null, error: gErr.message };
  if (!row) return { detail: null, error: 'Grupo no encontrado' };

  const { data: members, error: mErr } = await supabase
    .from('demand_route_members')
    .select('trip_request_id')
    .eq('group_id', groupId);

  if (mErr) return { detail: null, error: mErr.message };

  const requestIds = (members ?? []).map((m) => m.trip_request_id).filter(Boolean) as string[];

  let passengers: DemandRouteDetail['passengers'] = [];
  if (requestIds.length > 0) {
    const { data: reqs, error: rErr } = await supabase
      .from('trip_requests')
      .select('id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label')
      .in('id', requestIds);

    if (rErr) return { detail: null, error: rErr.message };
    passengers = (reqs ?? []).map((r) => ({
      trip_request_id: r.id,
      origin_lat: Number(r.origin_lat),
      origin_lng: Number(r.origin_lng),
      origin_label: r.origin_label ?? null,
      destination_lat: Number(r.destination_lat),
      destination_lng: Number(r.destination_lng),
      destination_label: r.destination_label ?? null,
    }));
  }

  const base = mapGroupRow(row as Record<string, unknown>);
  return { detail: { ...base, passengers } };
    })(),
    SUPABASE_QUERY_TIMEOUT_MS,
    () => ({
      detail: null,
      error:
        'Tiempo de espera al cargar el detalle de la ruta. Revisá conexión o intentá de nuevo.',
    })
  );
}

export async function fetchDemandRouteDetail(
  groupId: string
): Promise<{ detail: DemandRouteDetail | null; error?: string }> {
  if (getBase()) {
    const res = await apiGet(`/api/demand-routes/${groupId}`);
    if (res.ok) return { detail: res.data as DemandRouteDetail };
  }
  return fetchDemandRouteDetailFromSupabase(groupId);
}

export async function syncDemandRoutes(): Promise<{ ok: boolean; error?: string }> {
  const res = await apiPost('/api/demand-routes/sync', {});
  return { ok: res.ok, error: res.error };
}
