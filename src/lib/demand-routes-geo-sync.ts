import type { SupabaseClient } from '@supabase/supabase-js';
import { distancePointToPolylineMeters, getPositionAlongPolyline } from '@/lib/geo';
import type { Point } from '@/types';

const OSRM_BASE = 'https://router.project-osrm.org';
const CORRIDOR_METERS = 2000;
const TIME_WINDOW_MINUTES = 90;
const MAX_PASSENGERS_PER_GROUP = 15;

function timeToMinutes(t: string | null | undefined): number {
  if (!t) return 0;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function timeWithinWindow(a: number, b: number): boolean {
  let d = Math.abs(a - b);
  if (d > 12 * 60) d = 24 * 60 - d;
  return d <= TIME_WINDOW_MINUTES;
}

function polylineLengthKm(points: Point[]): number {
  if (points.length < 2) return 0;
  let m = 0;
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lng - p1.lng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    m += R * c;
  }
  return m / 1000;
}

async function fetchOsrmPolyline(origin: Point, destination: Point): Promise<Point[]> {
  const url = `${OSRM_BASE}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
    const coords = data.routes[0].geometry.coordinates as [number, number][];
    return coords.map(([lng, lat]) => ({ lat, lng }));
  }
  return [origin, destination];
}

export type DemandRoutesGeoSyncResult =
  | {
      ok: true;
      processed: number;
      addedToExisting: number;
      newGroupsCreated: number;
      message?: string;
    }
  | { ok: false; error: string };

/**
 * Misma lógica que POST /api/demand-routes/sync (agrupación geo ~2 km, ventana 90 min, ciudades).
 * Usa service role: llamar solo tras validar admin/conductor o cron.
 */
export async function runDemandRoutesGeoSync(supabase: SupabaseClient): Promise<DemandRoutesGeoSyncResult> {
  try {
    const { data: alreadyInGroup } = await supabase.from('demand_route_members').select('trip_request_id');
    const assignedIds = new Set((alreadyInGroup ?? []).map((r) => r.trip_request_id));

    const { data: pending, error: pendingError } = await supabase
      .from('trip_requests')
      .select(
        'id, origin_lat, origin_lng, destination_lat, destination_lng, requested_date, requested_time, origin_city, destination_city, origin_department, destination_department, origin_barrio, destination_barrio, route_polyline, route_length_km'
      )
      .eq('status', 'pending')
      .or('classification_status.is.null,classification_status.eq.unclassified')
      .not('origin_lat', 'is', null)
      .not('destination_lat', 'is', null);

    if (pendingError) {
      return { ok: false, error: pendingError.message };
    }

    const unassigned = (pending ?? []).filter((r) => !assignedIds.has(r.id));
    if (unassigned.length === 0) {
      return {
        ok: true,
        message: 'Nada que agrupar',
        processed: 0,
        addedToExisting: 0,
        newGroupsCreated: 0,
      };
    }

    for (const r of unassigned) {
      let polyline = Array.isArray(r.route_polyline) ? (r.route_polyline as Point[]) : null;
      if (!polyline || polyline.length < 2) {
        polyline = await fetchOsrmPolyline(
          { lat: r.origin_lat, lng: r.origin_lng },
          { lat: r.destination_lat, lng: r.destination_lng }
        );
        const lengthKm = polylineLengthKm(polyline);
        await supabase
          .from('trip_requests')
          .update({
            route_polyline: polyline,
            route_length_km: lengthKm,
            updated_at: new Date().toISOString(),
          })
          .eq('id', r.id);
        (r as { route_polyline?: Point[]; route_length_km?: number }).route_polyline = polyline;
        (r as { route_polyline?: Point[]; route_length_km?: number }).route_length_km = lengthKm;
      } else {
        (r as { route_length_km?: number }).route_length_km =
          r.route_length_km ?? polylineLengthKm(polyline);
      }
    }

    const withPolyline = unassigned.map((r) => ({
      ...r,
      route_polyline: (r as { route_polyline: Point[] }).route_polyline,
      route_length_km: (r as { route_length_km: number }).route_length_km,
    }));

    const sorted = [...withPolyline].sort((a, b) => (b.route_length_km ?? 0) - (a.route_length_km ?? 0));

    const { data: existingGroups } = await supabase
      .from('demand_route_groups')
      .select('id, base_polyline, requested_date, requested_time, origin_city, destination_city, passenger_count');
    const existing = (existingGroups ?? []).map((g) => ({
      id: g.id,
      base_polyline: (g.base_polyline ?? []) as Point[],
      requested_date: g.requested_date,
      requested_time: g.requested_time,
      origin_city: g.origin_city,
      destination_city: g.destination_city,
      passenger_count: g.passenger_count ?? 0,
    }));

    const newGroups: Array<{
      base_polyline: Point[];
      base_length_km: number;
      base_trip_request_id: string;
      requested_date: string;
      requested_time: string;
      origin_city: string | null;
      origin_department: string | null;
      origin_barrio: string | null;
      destination_city: string | null;
      destination_department: string | null;
      destination_barrio: string | null;
      passenger_count: number;
      memberIds: string[];
    }> = [];
    let addedToExisting = 0;

    for (const req of sorted) {
      const origin: Point = {
        lat: req.origin_lat,
        lng: req.origin_lng,
      };
      const dest: Point = {
        lat: req.destination_lat,
        lng: req.destination_lng,
      };
      const polyline = req.route_polyline ?? [origin, dest];
      const reqTimeMin = timeToMinutes(req.requested_time);
      const originCity = req.origin_city?.trim() || null;
      const destCity = req.destination_city?.trim() || null;

      const fitsGroup = (basePolyline: Point[]) => {
        const dO = distancePointToPolylineMeters(origin, basePolyline);
        const dD = distancePointToPolylineMeters(dest, basePolyline);
        if (dO > CORRIDOR_METERS || dD > CORRIDOR_METERS) return false;
        const posO = getPositionAlongPolyline(origin, basePolyline);
        const posD = getPositionAlongPolyline(dest, basePolyline);
        return posO < posD;
      };

      let placed = false;
      for (const g of existing) {
        if (g.passenger_count >= MAX_PASSENGERS_PER_GROUP) continue;
        if (g.requested_date !== req.requested_date) continue;
        if (!timeWithinWindow(timeToMinutes(g.requested_time), reqTimeMin)) continue;
        const sameOrigin =
          (g.origin_city == null && originCity == null) ||
          (g.origin_city !== null && originCity !== null && g.origin_city === originCity);
        const sameDest =
          (g.destination_city == null && destCity == null) ||
          (g.destination_city !== null && destCity !== null && g.destination_city === destCity);
        if (!sameOrigin || !sameDest) continue;
        if (!fitsGroup(g.base_polyline)) continue;

        const { error: memErr } = await supabase
          .from('demand_route_members')
          .insert({ group_id: g.id, trip_request_id: req.id });
        if (memErr) continue;
        await supabase
          .from('demand_route_groups')
          .update({
            passenger_count: g.passenger_count + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', g.id);
        g.passenger_count += 1;
        addedToExisting++;
        placed = true;
        break;
      }

      if (placed) continue;

      for (const g of newGroups) {
        if (g.memberIds.length >= MAX_PASSENGERS_PER_GROUP) continue;
        if (g.requested_date !== req.requested_date) continue;
        if (!timeWithinWindow(timeToMinutes(g.requested_time), reqTimeMin)) continue;
        const sameOrigin =
          (g.origin_city == null && originCity == null) ||
          (g.origin_city !== null && originCity !== null && g.origin_city === originCity);
        const sameDest =
          (g.destination_city == null && destCity == null) ||
          (g.destination_city !== null && destCity !== null && g.destination_city === destCity);
        if (!sameOrigin || !sameDest) continue;
        if (!fitsGroup(g.base_polyline)) continue;

        const posOrigin = getPositionAlongPolyline(origin, g.base_polyline);
        const posDest = getPositionAlongPolyline(dest, g.base_polyline);
        if (posOrigin >= posDest) continue;

        g.memberIds.push(req.id);
        g.passenger_count = g.memberIds.length;
        placed = true;
        break;
      }

      if (!placed) {
        newGroups.push({
          base_polyline: polyline,
          base_length_km: polylineLengthKm(polyline),
          base_trip_request_id: req.id,
          requested_date: req.requested_date,
          requested_time: req.requested_time ?? '08:00:00',
          origin_city: originCity,
          origin_department: req.origin_department?.trim() || null,
          origin_barrio: req.origin_barrio?.trim() || null,
          destination_city: destCity,
          destination_department: req.destination_department?.trim() || null,
          destination_barrio: req.destination_barrio?.trim() || null,
          passenger_count: 1,
          memberIds: [req.id],
        });
      }
    }

    for (const g of newGroups) {
      const { data: inserted, error: insErr } = await supabase
        .from('demand_route_groups')
        .insert({
          base_polyline: g.base_polyline,
          base_length_km: g.base_length_km,
          base_trip_request_id: g.base_trip_request_id,
          requested_date: g.requested_date,
          requested_time: g.requested_time,
          origin_city: g.origin_city,
          origin_department: g.origin_department,
          origin_barrio: g.origin_barrio,
          destination_city: g.destination_city,
          destination_department: g.destination_department,
          destination_barrio: g.destination_barrio,
          passenger_count: g.passenger_count,
        })
        .select('id')
        .single();

      if (insErr) {
        console.error('demand-routes sync insert group error:', insErr);
        continue;
      }
      const groupId = inserted?.id;
      if (!groupId) continue;

      for (const tripRequestId of g.memberIds) {
        await supabase.from('demand_route_members').insert({
          group_id: groupId,
          trip_request_id: tripRequestId,
        });
      }
    }

    return {
      ok: true,
      processed: unassigned.length,
      addedToExisting,
      newGroupsCreated: newGroups.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error interno',
    };
  }
}

/** Solo diagnóstico: por qué un pedido geo-elegible no entra a grupos existentes (misma lógica que el sync). */
export type GeoExplainTripRow = {
  trip_request_id: string;
  requested_date: string;
  requested_time: string;
  origin_city: string | null;
  destination_city: string | null;
  /** Si encaja en al menos un grupo existente (muestra). */
  outcome: 'matchable_existing' | 'no_match_in_existing_sample';
  matched_group_id?: string;
  /** Motivos distintos al escanear grupos (hasta ~8). */
  blocking_hints: string[];
  groups_scanned: number;
};

type TripReqLite = {
  id: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  requested_date: string;
  requested_time: string;
  origin_city: string | null;
  destination_city: string | null;
};

type GroupLite = {
  id: string;
  base_polyline: Point[];
  requested_date: string;
  requested_time: string;
  origin_city: string | null;
  destination_city: string | null;
  passenger_count: number;
};

function reasonCannotJoinGeo(req: TripReqLite, g: GroupLite): string | null {
  if (g.passenger_count >= MAX_PASSENGERS_PER_GROUP) return 'group_full';
  if (g.requested_date !== req.requested_date) return 'different_date';
  if (!timeWithinWindow(timeToMinutes(g.requested_time), timeToMinutes(req.requested_time))) {
    return 'outside_time_window_90m';
  }
  const originCity = req.origin_city?.trim() || null;
  const destCity = req.destination_city?.trim() || null;
  const sameOrigin =
    (g.origin_city == null && originCity == null) ||
    (g.origin_city !== null && originCity !== null && g.origin_city === originCity);
  const sameDest =
    (g.destination_city == null && destCity == null) ||
    (g.destination_city !== null && destCity !== null && g.destination_city === destCity);
  if (!sameOrigin) return 'origin_city_mismatch';
  if (!sameDest) return 'destination_city_mismatch';

  const base = g.base_polyline;
  if (!Array.isArray(base) || base.length < 2) return 'group_polyline_invalid';

  const origin: Point = { lat: Number(req.origin_lat), lng: Number(req.origin_lng) };
  const dest: Point = { lat: Number(req.destination_lat), lng: Number(req.destination_lng) };
  const dO = distancePointToPolylineMeters(origin, base);
  const dD = distancePointToPolylineMeters(dest, base);
  if (dO > CORRIDOR_METERS || dD > CORRIDOR_METERS) return 'outside_2km_corridor';
  const posO = getPositionAlongPolyline(origin, base);
  const posD = getPositionAlongPolyline(dest, base);
  if (!(posO < posD)) return 'wrong_stop_order_along_route';
  return null;
}

/**
 * Muestra acotada (solo lectura): pedidos pending/unclassified con coords que aún no están en miembros,
 * y si podrían unirse a algún grupo existente según las mismas reglas que `runDemandRoutesGeoSync`.
 */
export async function sampleGeoUnassignedExplain(
  supabase: SupabaseClient,
  opts?: { maxRequests?: number; maxGroups?: number; pendingFetchCap?: number }
): Promise<{
  trips: GeoExplainTripRow[];
  existing_group_count: number;
  unassigned_in_pending_sample: number;
  pending_fetch_cap: number;
  error?: string;
}> {
  const maxRequests = Math.min(60, Math.max(1, opts?.maxRequests ?? 25));
  const maxGroups = Math.min(200, Math.max(1, opts?.maxGroups ?? 80));
  const pendingFetchCap = Math.min(800, Math.max(50, opts?.pendingFetchCap ?? 500));

  const { data: alreadyInGroup } = await supabase.from('demand_route_members').select('trip_request_id');
  const assignedIds = new Set((alreadyInGroup ?? []).map((r) => r.trip_request_id));

  const { data: pending, error: pendingError } = await supabase
    .from('trip_requests')
    .select(
      'id, origin_lat, origin_lng, destination_lat, destination_lng, requested_date, requested_time, origin_city, destination_city'
    )
    .eq('status', 'pending')
    .or('classification_status.is.null,classification_status.eq.unclassified')
    .not('origin_lat', 'is', null)
    .not('destination_lat', 'is', null)
    .limit(pendingFetchCap);

  if (pendingError) {
    return {
      trips: [],
      existing_group_count: 0,
      unassigned_in_pending_sample: 0,
      pending_fetch_cap: pendingFetchCap,
      error: pendingError.message,
    };
  }

  const unassigned = (pending ?? []).filter((r) => !assignedIds.has(r.id)) as TripReqLite[];

  const { data: existingGroups, error: gErr } = await supabase
    .from('demand_route_groups')
    .select('id, base_polyline, requested_date, requested_time, origin_city, destination_city, passenger_count')
    .limit(maxGroups);

  if (gErr) {
    return {
      trips: [],
      existing_group_count: 0,
      unassigned_in_pending_sample: unassigned.length,
      pending_fetch_cap: pendingFetchCap,
      error: gErr.message,
    };
  }

  const existing: GroupLite[] = (existingGroups ?? []).map((g) => ({
    id: String(g.id),
    base_polyline: (g.base_polyline ?? []) as Point[],
    requested_date: String(g.requested_date ?? ''),
    requested_time: String(g.requested_time ?? ''),
    origin_city: g.origin_city ?? null,
    destination_city: g.destination_city ?? null,
    passenger_count: Number(g.passenger_count ?? 0) || 0,
  }));

  const trips: GeoExplainTripRow[] = [];
  for (const req of unassigned.slice(0, maxRequests)) {
    let matchedId: string | undefined;
    for (const g of existing) {
      if (reasonCannotJoinGeo(req, g) == null) {
        matchedId = g.id;
        break;
      }
    }
    if (matchedId) {
      trips.push({
        trip_request_id: req.id,
        requested_date: req.requested_date,
        requested_time: String(req.requested_time),
        origin_city: req.origin_city,
        destination_city: req.destination_city,
        outcome: 'matchable_existing',
        matched_group_id: matchedId,
        blocking_hints: [],
        groups_scanned: existing.length,
      });
      continue;
    }

    const hints = new Set<string>();
    let scanned = 0;
    for (const g of existing) {
      scanned++;
      const reason = reasonCannotJoinGeo(req, g);
      if (reason) hints.add(reason);
      if (hints.size >= 8) break;
    }
    trips.push({
      trip_request_id: req.id,
      requested_date: req.requested_date,
      requested_time: String(req.requested_time),
      origin_city: req.origin_city,
      destination_city: req.destination_city,
      outcome: 'no_match_in_existing_sample',
      blocking_hints: Array.from(hints),
      groups_scanned: scanned,
    });
  }

  return {
    trips,
    existing_group_count: existing.length,
    unassigned_in_pending_sample: unassigned.length,
    pending_fetch_cap: pendingFetchCap,
  };
}

/** Pedidos listos para `auto_group_classified_trip_requests` (pending + classified + corredor + bucket, sin miembro). */
export type ClassifiedReadyRow = {
  id: string;
  corridor_id: string;
  time_bucket: string;
  requested_date: string;
  requested_time: string;
  origin_city: string | null;
  destination_city: string | null;
};

export async function sampleClassifiedReadyExplain(
  supabase: SupabaseClient,
  opts?: { maxRows?: number; fetchCap?: number }
): Promise<{
  rows: ClassifiedReadyRow[];
  fetch_size: number;
  unassigned_in_fetch: number;
  error?: string;
}> {
  const maxRows = Math.min(40, Math.max(1, opts?.maxRows ?? 15));
  const fetchCap = Math.min(120, Math.max(20, opts?.fetchCap ?? 80));

  const { data: mems, error: mErr } = await supabase.from('demand_route_members').select('trip_request_id');
  if (mErr) {
    return { rows: [], fetch_size: 0, unassigned_in_fetch: 0, error: mErr.message };
  }
  const assigned = new Set((mems ?? []).map((m) => m.trip_request_id));

  const { data: raw, error } = await supabase
    .from('trip_requests')
    .select('id, corridor_id, time_bucket, requested_date, requested_time, origin_city, destination_city')
    .eq('status', 'pending')
    .eq('classification_status', 'classified')
    .not('corridor_id', 'is', null)
    .not('time_bucket', 'is', null)
    .limit(fetchCap);

  if (error) {
    return { rows: [], fetch_size: 0, unassigned_in_fetch: 0, error: error.message };
  }

  const list = (raw ?? []).filter((r) => !assigned.has(r.id));
  const rows: ClassifiedReadyRow[] = list.slice(0, maxRows).map((r) => ({
    id: r.id,
    corridor_id: String(r.corridor_id),
    time_bucket: String(r.time_bucket),
    requested_date: String(r.requested_date ?? ''),
    requested_time: String(r.requested_time ?? ''),
    origin_city: r.origin_city ?? null,
    destination_city: r.destination_city ?? null,
  }));

  return {
    rows,
    fetch_size: raw?.length ?? 0,
    unassigned_in_fetch: list.length,
  };
}
