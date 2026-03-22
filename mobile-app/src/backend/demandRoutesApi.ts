/**
 * Rutas con demanda agrupadas: listado y detalle para conductor (y pasajero).
 * Llama a Next.js GET /api/demand-routes y GET /api/demand-routes/[id].
 * Sync: POST /api/demand-routes/sync (driver/admin) para recomputar grupos.
 */
import { apiGet, apiPost } from './api';
import { env } from '../core/env';

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

export async function fetchDemandRoutes(params?: {
  origin_city?: string;
  destination_city?: string;
  requested_date_from?: string;
  requested_date_to?: string;
}): Promise<{ groups: DemandRouteGroup[]; error?: string }> {
  const base = getBase();
  if (!base) return { groups: [], error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  const sp = new URLSearchParams();
  if (params?.origin_city) sp.set('origin_city', params.origin_city);
  if (params?.destination_city) sp.set('destination_city', params.destination_city);
  if (params?.requested_date_from) sp.set('requested_date_from', params.requested_date_from);
  if (params?.requested_date_to) sp.set('requested_date_to', params.requested_date_to);
  const qs = sp.toString();
  const path = `/api/demand-routes${qs ? `?${qs}` : ''}`;
  const res = await apiGet(path);
  if (!res.ok) return { groups: [], error: res.error ?? 'Error al cargar rutas' };
  const data = res.data as { groups?: DemandRouteGroup[] };
  return { groups: data.groups ?? [] };
}

export async function fetchDemandRouteDetail(
  groupId: string
): Promise<{ detail: DemandRouteDetail | null; error?: string }> {
  const base = getBase();
  if (!base) return { detail: null, error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  const res = await apiGet(`/api/demand-routes/${groupId}`);
  if (!res.ok) return { detail: null, error: res.error ?? 'Error al cargar detalle' };
  return { detail: res.data as DemandRouteDetail };
}

export async function syncDemandRoutes(): Promise<{ ok: boolean; error?: string }> {
  const res = await apiPost('/api/demand-routes/sync', {});
  return { ok: res.ok, error: res.error };
}
