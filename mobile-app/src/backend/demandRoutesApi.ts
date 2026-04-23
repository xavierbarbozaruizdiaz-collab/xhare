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
import { dedupeDemandRouteLegsForUi, dedupeDemandRouteMemberRows } from '../lib/demandRouteMembersDedupe';
import { raceWithTimeout } from './withTimeout';
import type { EffectivePricing, PricingSettingsRow } from '../lib/pricing/runtime-pricing';
import { computeEffectivePricing, loadActivePricingSettings } from '../lib/pricing/runtime-pricing';
import {
  baseFareFromDistanceKmWithPricing,
  totalFareFromBaseAndSeatsWithPricing,
  MIN_FARE_PYG,
  PYG_PER_KM,
} from '../lib/pricing/segment-fare';

const SUPABASE_QUERY_TIMEOUT_MS = 28_000;

function getBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

export type DemandRouteGroup = {
  id: string;
  ride_id?: string | null;
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
  grouping_source?: string | null;
  created_at?: string;
};

export type DemandRouteDetail = DemandRouteGroup & {
  base_trip_request_id?: string | null;
  ride_id?: string | null;
  route_polyline?: Array<{ lat: number; lng: number }>;
  legs?: Array<{
    visit_order: number;
    stop_type: 'PICKUP' | 'DROPOFF' | 'LEGACY';
    trip_request_id: string;
    passenger_name: string;
    label: string;
    action: string;
    fare_amount?: number | null;
    lat: number | null;
    lng: number | null;
  }>;
  financial_summary?: {
    total_passengers: number;
    grouped_seats_taken?: number;
    grouped_seats_capacity?: number;
    grouped_seats_available?: number;
    total_to_collect_gs: number;
    driver_fee_percent: number;
    driver_fee_gs: number;
    driver_net_earnings_gs: number;
    currency: 'PYG';
  };
  passengers: Array<{
    trip_request_id: string;
    requested_time?: string | null;
    origin_lat: number;
    origin_lng: number;
    origin_label: string | null;
    destination_lat: number;
    destination_lng: number;
    destination_label: string | null;
  }>;
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function tripCollectTotalGs(
  r: {
    passenger_desired_price_per_seat_gs?: number | null;
    seats?: number | null;
    origin_lat: number;
    origin_lng: number;
    destination_lat: number;
    destination_lng: number;
  },
  eff: EffectivePricing
): number {
  const seats = Number.isFinite(Number(r.seats)) ? Math.max(1, Number(r.seats)) : 1;
  const per = Number(r.passenger_desired_price_per_seat_gs ?? 0);
  if (Number.isFinite(per) && per > 0) return Math.round(per * seats);
  const dKm = Math.max(
    0.5,
    haversineKm(
      Number(r.origin_lat),
      Number(r.origin_lng),
      Number(r.destination_lat),
      Number(r.destination_lng)
    ) * 1.2
  );
  const base = baseFareFromDistanceKmWithPricing(dKm, eff);
  return totalFareFromBaseAndSeatsWithPricing(base, seats, eff);
}

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
    ride_id: row.ride_id != null ? String(row.ride_id) : null,
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
    grouping_source: row.grouping_source != null ? String(row.grouping_source) : null,
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
      'id, ride_id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, grouping_source, created_at'
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
      'id, ride_id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, grouping_source, created_at'
    )
    .eq('id', groupId)
    .maybeSingle();

  if (gErr) return { detail: null, error: gErr.message };
  if (!row) return { detail: null, error: 'Grupo no encontrado' };

  const { data: members, error: mErr } = await supabase
    .from('demand_route_members')
    .select('trip_request_id, stop_type, visit_order')
    .eq('group_id', groupId);

  if (mErr) return { detail: null, error: mErr.message };

  const requestIds = (members ?? []).map((m) => m.trip_request_id).filter(Boolean) as string[];

  let passengers: DemandRouteDetail['passengers'] = [];
  let legs: NonNullable<DemandRouteDetail['legs']> = [];
  let totalToCollectFromRequests = 0;
  let groupedSeatsTaken = 0;
  let pricingRowForFees: PricingSettingsRow | null = null;
  {
    const { data: reqsByGroup, error: byGroupErr } = await supabase
      .from('trip_requests')
      .select(
        'id, user_id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, requested_time, passenger_desired_price_per_seat_gs, seats, status, ride_id'
      )
      .eq('demand_group_id', groupId);
    if (byGroupErr) return { detail: null, error: byGroupErr.message };

    let reqsByMembers: typeof reqsByGroup = [];
    if (requestIds.length > 0) {
      const { data: reqsMembers, error: rErr } = await supabase
      .from('trip_requests')
      .select(
        'id, user_id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, requested_time, passenger_desired_price_per_seat_gs, seats, status, ride_id'
      )
      .in('id', requestIds);
      if (rErr) return { detail: null, error: rErr.message };
      reqsByMembers = reqsMembers ?? [];
    }

    const byId = new Map<string, NonNullable<typeof reqsByGroup>[number]>();
    for (const r of reqsByGroup ?? []) byId.set(String(r.id), r);
    for (const r of reqsByMembers ?? []) byId.set(String(r.id), r);
    let reqs = Array.from(byId.values());
    if (requestIds.length > 0) {
      const memberTripIds = new Set(requestIds.map((id) => String(id)));
      reqs = reqs.filter((r) => memberTripIds.has(String(r.id)));
    }

    if (requestIds.length > 0 && reqs.length === 0) {
      return {
        detail: null,
        error:
          'No se pudieron leer los pedidos del grupo (RLS). En Supabase aplicá la migración 080, o configurá EXPO_PUBLIC_API_BASE_URL para usar el detalle vía API.',
      };
    }

    const groupRideId =
      (row as { ride_id?: string | null }).ride_id != null
        ? String((row as { ride_id?: string | null }).ride_id).trim()
        : '';
    reqs = reqs.filter((r) => {
      const st = String((r as { status?: string }).status ?? '');
      if (st === 'grouped' || st === 'group_linked_pending') return true;
      if (st === 'accepted' && groupRideId) {
        const rid = (r as { ride_id?: string | null }).ride_id;
        return rid != null && String(rid).trim() === groupRideId;
      }
      return false;
    });

    groupedSeatsTaken = (reqs ?? []).reduce((sum, r) => {
      const s = Number((r as { seats?: number }).seats ?? 1);
      return sum + (Number.isFinite(s) && s > 0 ? s : 1);
    }, 0);

    pricingRowForFees = await loadActivePricingSettings();
    const eff: EffectivePricing = pricingRowForFees
      ? computeEffectivePricing(pricingRowForFees)
      : {
          minFarePyg: MIN_FARE_PYG,
          pygPerKm: PYG_PER_KM,
          roundTo: 100,
          blockSize: 4,
          blockMultiplier: 1.5,
          driverFeePercentOfCollected: 10,
          pricingSettingsId: null,
        };

    totalToCollectFromRequests = (reqs ?? []).reduce(
      (sum, r) =>
        sum +
        tripCollectTotalGs(
          {
            passenger_desired_price_per_seat_gs: (r as { passenger_desired_price_per_seat_gs?: number | null })
              .passenger_desired_price_per_seat_gs,
            seats: (r as { seats?: number }).seats,
            origin_lat: Number(r.origin_lat),
            origin_lng: Number(r.origin_lng),
            destination_lat: Number(r.destination_lat),
            destination_lng: Number(r.destination_lng),
          },
          eff
        ),
      0
    );

    passengers = (reqs ?? []).map((r) => ({
      trip_request_id: r.id,
      requested_time: (r as { requested_time?: string | null }).requested_time ?? null,
      origin_lat: Number(r.origin_lat),
      origin_lng: Number(r.origin_lng),
      origin_label: r.origin_label ?? null,
      destination_lat: Number(r.destination_lat),
      destination_lng: Number(r.destination_lng),
      destination_label: r.destination_label ?? null,
    }));

    const byReq: Record<
      string,
      {
        user_id: string | null;
        origin_label: string | null;
        destination_label: string | null;
        origin_lat: number;
        origin_lng: number;
        destination_lat: number;
        destination_lng: number;
        collect_total_gs: number;
        seats: number;
      }
    > = {};
    for (const r of reqs ?? []) {
      const seats = Number.isFinite(Number((r as { seats?: number }).seats))
        ? Math.max(1, Number((r as { seats?: number }).seats))
        : 1;
      const rid = String(r.id);
      byReq[rid] = {
        user_id: r.user_id ?? null,
        origin_label: r.origin_label ?? null,
        destination_label: r.destination_label ?? null,
        origin_lat: Number(r.origin_lat),
        origin_lng: Number(r.origin_lng),
        destination_lat: Number(r.destination_lat),
        destination_lng: Number(r.destination_lng),
        collect_total_gs: tripCollectTotalGs(
          {
            passenger_desired_price_per_seat_gs: (r as { passenger_desired_price_per_seat_gs?: number | null })
              .passenger_desired_price_per_seat_gs,
            seats: (r as { seats?: number }).seats,
            origin_lat: Number(r.origin_lat),
            origin_lng: Number(r.origin_lng),
            destination_lat: Number(r.destination_lat),
            destination_lng: Number(r.destination_lng),
          },
          eff
        ),
        seats,
      };
    }

    const uids = Array.from(
      new Set(
        (reqs ?? [])
          .map((r) => String(r.user_id ?? '').trim())
          .filter((x) => x.length > 0)
      )
    );
    const nameByUid: Record<string, string> = {};
    if (uids.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', uids);
      for (const p of profs ?? []) {
        const id = String(p.id ?? '');
        const nm = String(p.full_name ?? '').trim();
        if (id) nameByUid[id] = nm || `Pasajero ${id.slice(0, 6)}`;
      }
    }

    const rawMembersFiltered = (members ?? []).filter((m) => byReq[String(m.trip_request_id ?? '')]);
    const memberRows =
      rawMembersFiltered.length > 0
        ? dedupeDemandRouteMemberRows(
            rawMembersFiltered as Array<{
              trip_request_id: string;
              stop_type: string | null;
              visit_order: number | null;
            }>
          )
        : reqs.flatMap((r, i) => [
            { trip_request_id: r.id, stop_type: 'PICKUP' as const, visit_order: i * 2 + 1 },
            { trip_request_id: r.id, stop_type: 'DROPOFF' as const, visit_order: i * 2 + 2 },
          ]);

    legs = memberRows
      .map((m) => {
        const reqId = String(m.trip_request_id ?? '');
        const req = byReq[reqId];
        if (!req) return null;
        const stRaw = String(m.stop_type ?? 'LEGACY').toUpperCase();
        const st: 'PICKUP' | 'DROPOFF' | 'LEGACY' =
          stRaw === 'PICKUP' || stRaw === 'DROPOFF' ? stRaw : 'LEGACY';
        const nm =
          (req.user_id && nameByUid[req.user_id]) ||
          `Pasajero ${(req.user_id ?? reqId).slice(0, 6)}`;
        const label = st === 'DROPOFF' ? req.destination_label ?? 'Destino' : req.origin_label ?? 'Origen';
        const lat = st === 'DROPOFF' ? req.destination_lat : req.origin_lat;
        const lng = st === 'DROPOFF' ? req.destination_lng : req.origin_lng;
        const pickupTotalGs = st === 'PICKUP' ? Math.max(0, Number(req.collect_total_gs ?? 0)) : null;
        return {
          visit_order: Number(m.visit_order ?? 0),
          stop_type: st,
          trip_request_id: reqId,
          passenger_name: nm,
          label,
          action: st === 'DROPOFF' ? `Baja ${nm}` : `Sube ${nm}`,
          fare_amount: pickupTotalGs,
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => a.visit_order - b.visit_order);

    legs = dedupeDemandRouteLegsForUi(
      legs as Array<{ trip_request_id: string; stop_type: string; visit_order: number }>
    ) as typeof legs;
  }

  const driverFeePercent = pricingRowForFees
    ? computeEffectivePricing(pricingRowForFees).driverFeePercentOfCollected
    : 10;
  const totalToCollectGs = totalToCollectFromRequests;
  const driverFeeGs = Math.round((totalToCollectGs * driverFeePercent) / 100);
  const driverNetEarningsGs = Math.max(0, totalToCollectGs - driverFeeGs);
  const groupedSeatsCapacity = 15;
  const groupedSeatsAvailable = Math.max(0, groupedSeatsCapacity - groupedSeatsTaken);

  const base = mapGroupRow(row as Record<string, unknown>);
  return {
    detail: {
      ...base,
      ride_id: (row as { ride_id?: string | null }).ride_id != null ? String((row as { ride_id?: string | null }).ride_id) : null,
      passenger_count: passengers.length,
      route_polyline: parsePolyline((row as Record<string, unknown>).route_polyline ?? (row as Record<string, unknown>).base_polyline),
      passengers,
      legs,
      financial_summary: {
        total_passengers: passengers.length,
        grouped_seats_taken: groupedSeatsTaken,
        grouped_seats_capacity: groupedSeatsCapacity,
        grouped_seats_available: groupedSeatsAvailable,
        total_to_collect_gs: totalToCollectGs,
        driver_fee_percent: driverFeePercent,
        driver_fee_gs: driverFeeGs,
        driver_net_earnings_gs: driverNetEarningsGs,
        currency: 'PYG',
      },
    },
  };
    })(),
    SUPABASE_QUERY_TIMEOUT_MS,
    () => ({
      detail: null,
      error:
        'Tiempo de espera al cargar el detalle de la ruta. Revisá conexión o intentá de nuevo.',
    })
  );
}

/**
 * Para viajes `awaiting_driver` materializados: el grupo suele estar en `demand_route_groups.ride_id`.
 * Tras reparaciones SQL a veces queda desalineado pero los `trip_requests` siguen con `ride_id` + `demand_group_id`.
 */
export async function buildRideIdToDemandGroupMap(rideIds: string[]): Promise<Record<string, string>> {
  const ids = Array.from(
    new Set(rideIds.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0))
  );
  const out: Record<string, string> = {};
  if (ids.length === 0 || !isEnvConfigured()) return out;

  const { data: dgRows, error: dgErr } = await supabase
    .from('demand_route_groups')
    .select('id, ride_id')
    .in('ride_id', ids);
  if (!dgErr) {
    for (const row of dgRows ?? []) {
      const rid = String((row as { ride_id?: string | null }).ride_id ?? '').trim();
      const gid = String((row as { id?: string | null }).id ?? '').trim();
      if (rid && gid) out[rid] = gid;
    }
  }

  const missing = ids.filter((id) => !out[id]);
  if (missing.length === 0) return out;

  const { data: trRows, error: trErr } = await supabase
    .from('trip_requests')
    .select('ride_id, demand_group_id')
    .in('ride_id', missing)
    .not('demand_group_id', 'is', null);
  if (!trErr && trRows && trRows.length > 0) {
    const ridToGids = new Map<string, Set<string>>();
    for (const row of trRows) {
      const rid = String((row as { ride_id?: string | null }).ride_id ?? '').trim();
      const gid = String((row as { demand_group_id?: string | null }).demand_group_id ?? '').trim();
      if (!rid || !gid || out[rid]) continue;
      if (!ridToGids.has(rid)) ridToGids.set(rid, new Set());
      ridToGids.get(rid)!.add(gid);
    }
    const allGids = [...new Set([...ridToGids.values()].flatMap((s) => [...s]))];
    if (allGids.length > 0) {
      const { data: grpRows, error: grpErr } = await supabase
        .from('demand_route_groups')
        .select('id, ride_id')
        .in('id', allGids);
      const groupLinkedRide = new Map<string, string | null>();
      if (!grpErr) {
        for (const g of grpRows ?? []) {
          const id = String((g as { id?: string | null }).id ?? '').trim();
          const rv = (g as { ride_id?: string | null }).ride_id;
          groupLinkedRide.set(id, rv != null && String(rv).trim() !== '' ? String(rv).trim() : null);
        }
      }
      for (const [rid, gids] of ridToGids) {
        if (out[rid]) continue;
        const gidList = [...gids];
        const preferred = gidList.find((gid) => groupLinkedRide.get(gid) === rid);
        const fallbackUnassigned = gidList.find((gid) => groupLinkedRide.get(gid) == null);
        const chosen = preferred ?? fallbackUnassigned;
        if (chosen) out[rid] = chosen;
      }
    }
  }

  return out;
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
