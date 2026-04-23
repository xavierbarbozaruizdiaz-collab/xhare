import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeDropoffOrderWithGoogle,
  computePickupOrderWithGoogle,
  getGoogleRoutesTimeoutMsHexCap,
} from '@/lib/google-routes-polyline';

export type HexGroupLeg = {
  visitOrder: number;
  stopType: 'PICKUP' | 'DROPOFF';
  tripRequestId: string;
  passengerName: string;
  label: string;
  action: string;
};

export type HexGroupOptimizeResult = {
  groupId: string;
  ok: boolean;
  degraded?: boolean;
  legs?: HexGroupLeg[];
  error?: string;
  /** Fase 1 (pickups): índices intermedios optimizados. */
  googleOptimizedIntermediateWaypointIndex?: number[];
  /** Fase 2 (drops): índices intermedios optimizados. */
  googleDropoffIntermediateWaypointIndex?: number[];
};

type TripRow = {
  trip_request_id: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  user_id: string;
  origin_label: string | null;
  destination_label: string | null;
};

type TripRequestGeoRow = Omit<TripRow, 'trip_request_id'>;
type ScheduledEvent = { trip: TripRow; stopType: 'PICKUP' | 'DROPOFF'; progress: number };

function meanPoint(rows: TripRow[]): { lat: number; lng: number } {
  if (rows.length === 0) return { lat: -25.3, lng: -57.6 };
  let slat = 0;
  let slng = 0;
  for (const r of rows) {
    slat += r.destination_lat;
    slng += r.destination_lng;
  }
  return { lat: slat / rows.length, lng: slng / rows.length };
}

async function loadProfileNames(
  service: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(userIds)).filter(Boolean);
  const map = new Map<string, string>();
  if (uniq.length === 0) return map;
  const { data, error } = await service.from('profiles').select('id, full_name').in('id', uniq);
  if (error || !data) return map;
  for (const row of data as { id: string; full_name: string | null }[]) {
    const fallback = `Pasajero ${String(row.id ?? '').slice(0, 6)}`;
    map.set(row.id, String(row.full_name ?? '').trim() || fallback);
  }
  return map;
}

function projectProgress(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): number {
  const vx = end.lng - start.lng;
  const vy = end.lat - start.lat;
  const wx = point.lng - start.lng;
  const wy = point.lat - start.lat;
  const vNorm2 = vx * vx + vy * vy;
  if (vNorm2 < 1e-12) {
    return point.lat + point.lng;
  }
  return (wx * vx + wy * vy) / Math.sqrt(vNorm2);
}

function buildMixedPdpSequence(trips: TripRow[], dropRanks: Map<string, number>): ScheduledEvent[] {
  if (trips.length === 0) return [];
  const start = { lat: trips[0].origin_lat, lng: trips[0].origin_lng };
  const end = meanPoint(trips);
  const picked = new Set<string>();
  const dropped = new Set<string>();
  const out: ScheduledEvent[] = [];
  let currentProgress = -1e12;

  while (out.length < trips.length * 2) {
    const candidates: ScheduledEvent[] = [];
    for (let i = 0; i < trips.length; i++) {
      const tr = trips[i];
      if (!picked.has(tr.trip_request_id)) {
        const base = projectProgress({ lat: tr.origin_lat, lng: tr.origin_lng }, start, end) + i * 1e-4;
        candidates.push({
          trip: tr,
          stopType: 'PICKUP',
          progress: Math.max(currentProgress, base),
        });
        continue;
      }
      if (!dropped.has(tr.trip_request_id)) {
        const rank = dropRanks.get(tr.trip_request_id) ?? i;
        const base = projectProgress({ lat: tr.destination_lat, lng: tr.destination_lng }, start, end) + rank * 1e-4 + 5e-5;
        candidates.push({
          trip: tr,
          stopType: 'DROPOFF',
          progress: Math.max(currentProgress, base),
        });
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => {
      if (a.progress !== b.progress) return a.progress - b.progress;
      if (a.stopType !== b.stopType) return a.stopType === 'PICKUP' ? -1 : 1;
      return a.trip.trip_request_id.localeCompare(b.trip.trip_request_id);
    });
    const chosen = candidates[0];
    out.push(chosen);
    currentProgress = chosen.progress;
    if (chosen.stopType === 'PICKUP') picked.add(chosen.trip.trip_request_id);
    else dropped.add(chosen.trip.trip_request_id);
  }

  return out;
}

async function optimizeOneHexGroup(
  service: SupabaseClient,
  apiKey: string,
  groupId: string
): Promise<HexGroupOptimizeResult> {
  const { data: gRow, error: gErr } = await service
    .from('demand_route_groups')
    .select('id, grouping_source')
    .eq('id', groupId)
    .maybeSingle();
  if (gErr || !gRow || (gRow as { grouping_source?: string }).grouping_source !== 'hex_bucket') {
    return { groupId, ok: false, error: 'Grupo no encontrado o no es hex_bucket' };
  }

  const { data: pRows, error: pErr } = await service
    .from('demand_route_members')
    .select(
      `
      trip_request_id,
      trip_requests!inner (
        origin_lat,
        origin_lng,
        destination_lat,
        destination_lng,
        user_id,
        origin_label,
        destination_label
      )
    `
    )
    .eq('group_id', groupId)
    .eq('stop_type', 'PICKUP')
    .order('visit_order', { ascending: true });

  if (pErr || !pRows?.length) {
    return { groupId, ok: false, error: pErr?.message ?? 'Sin pickups' };
  }

  const trips: TripRow[] = (pRows as unknown as { trip_request_id: string; trip_requests: TripRequestGeoRow }[]).map(
    (r) => ({
      trip_request_id: r.trip_request_id,
      ...r.trip_requests,
    })
  );

  const n = trips.length;
  const timeoutMs = getGoogleRoutesTimeoutMsHexCap();
  let optimizedIdx: number[] | null = null;
  let degraded = false;
  let googleError: string | undefined;

  if (n < 2) {
    optimizedIdx = [];
  } else {
    const first = trips[0];
    const rest = trips.slice(1);
    const intermediates = rest.map((t) => ({ lat: t.origin_lat, lng: t.origin_lng }));
    const anchor = meanPoint(trips);
    const res = await computePickupOrderWithGoogle(
      apiKey,
      { lat: first.origin_lat, lng: first.origin_lng },
      anchor,
      intermediates,
      timeoutMs
    );
    if (res) {
      optimizedIdx = res.optimizedIntermediateWaypointIndex;
      const bad =
        optimizedIdx.length !== rest.length ||
        !optimizedIdx.every((i) => Number.isInteger(i) && i >= 0 && i < rest.length);
      if (bad) {
        degraded = true;
        googleError = 'Respuesta Google inválida; se usa orden naive FIFO';
        optimizedIdx = rest.map((_, i) => i);
      }
    } else {
      degraded = true;
      googleError = 'Google Routes timeout o error; se mantiene orden naive FIFO';
      optimizedIdx = rest.map((_, i) => i);
    }
  }

  let newTripOrder: TripRow[];
  if (n < 2) {
    newTripOrder = trips;
  } else {
    const first = trips[0];
    const rest = trips.slice(1);
    const perm = optimizedIdx ?? rest.map((_, i) => i);
    const reorderedRest = perm.map((inputIdx) => rest[inputIdx]).filter(Boolean);
    newTripOrder = [first, ...reorderedRest];
  }

  const nFinal = newTripOrder.length;
  let optimizedDropIdx: number[] = [];
  let degradedDrop = false;
  let googleDropError: string | undefined;
  let dropRankMap = new Map<string, number>();

  if (nFinal < 2) {
    dropRankMap = new Map(newTripOrder.map((tr, i) => [tr.trip_request_id, i]));
  } else {
    const last = newTripOrder[nFinal - 1];
    const lastPickupLoc = { lat: last.origin_lat, lng: last.origin_lng };
    const intermediateDrops = newTripOrder.slice(0, nFinal - 1).map((t) => ({
      lat: t.destination_lat,
      lng: t.destination_lng,
    }));
    const finalDrop = { lat: last.destination_lat, lng: last.destination_lng };

    const resDrop = await computeDropoffOrderWithGoogle(
      apiKey,
      lastPickupLoc,
      intermediateDrops,
      finalDrop,
      timeoutMs
    );

    if (resDrop) {
      optimizedDropIdx = resDrop.optimizedIntermediateWaypointIndex;
      const restLen = nFinal - 1;
      const badDrop =
        optimizedDropIdx.length !== restLen ||
        !optimizedDropIdx.every((i) => Number.isInteger(i) && i >= 0 && i < restLen);
      if (badDrop) {
        degradedDrop = true;
        googleDropError = 'Fase 2: respuesta Google inválida; orden de bajadas = orden de subidas';
        optimizedDropIdx = newTripOrder.slice(0, restLen).map((_, i) => i);
        dropRankMap = new Map(newTripOrder.map((tr, i) => [tr.trip_request_id, i]));
      } else {
        const reorderedMid = optimizedDropIdx.map((inputIdx) => newTripOrder[inputIdx]);
        const dropOrderTrips = [...reorderedMid, last];
        dropRankMap = new Map(dropOrderTrips.map((tr, i) => [tr.trip_request_id, i]));
      }
    } else {
      degradedDrop = true;
      googleDropError = 'Fase 2: timeout o error Google; orden de bajadas = orden de subidas';
      optimizedDropIdx = newTripOrder.slice(0, nFinal - 1).map((_, i) => i);
      dropRankMap = new Map(newTripOrder.map((tr, i) => [tr.trip_request_id, i]));
    }
  }
  const mixed = buildMixedPdpSequence(newTripOrder, dropRankMap);
  for (let i = 0; i < mixed.length; i++) {
    const ev = mixed[i];
    const { error: upErr } = await service
      .from('demand_route_members')
      .update({ visit_order: i + 1 })
      .eq('group_id', groupId)
      .eq('trip_request_id', ev.trip.trip_request_id)
      .eq('stop_type', ev.stopType);
    if (upErr) {
      return { groupId, ok: false, error: upErr.message };
    }
  }

  const degradedAny = degraded || degradedDrop;

  const names = await loadProfileNames(
    service,
    newTripOrder.map((t) => t.user_id)
  );

  const { data: allMembers } = await service
    .from('demand_route_members')
    .select(
      `
      visit_order,
      stop_type,
      trip_request_id,
      trip_requests!inner ( origin_label, destination_label, user_id )
    `
    )
    .eq('group_id', groupId)
    .in('stop_type', ['PICKUP', 'DROPOFF'])
    .order('visit_order', { ascending: true });

  const legs: HexGroupLeg[] = [];
  if (allMembers) {
    for (const m of allMembers as unknown as {
      visit_order: number | null;
      stop_type: string;
      trip_request_id: string;
      trip_requests: {
        origin_label: string | null;
        destination_label: string | null;
        user_id: string;
      };
    }[]) {
      const st = m.stop_type === 'PICKUP' ? 'PICKUP' : 'DROPOFF';
      const label =
        st === 'PICKUP'
          ? String(m.trip_requests?.origin_label ?? 'Origen')
          : String(m.trip_requests?.destination_label ?? 'Destino');
      const nm =
        names.get(m.trip_requests.user_id) ??
        `Pasajero ${String(m.trip_requests.user_id ?? m.trip_request_id).slice(0, 6)}`;
      legs.push({
        visitOrder: m.visit_order ?? 0,
        stopType: st,
        tripRequestId: m.trip_request_id,
        passengerName: nm,
        label,
        action: st === 'PICKUP' ? `Sube ${nm ?? 'pasajero'}` : `Baja ${nm ?? 'pasajero'}`,
      });
    }
    legs.sort((a, b) => a.visitOrder - b.visitOrder);
  }

  const meta = {
    engine: degradedAny ? 'google_pdp_partial_or_naive' : 'google_pdp_two_phase_v2',
    degraded: degradedAny,
    google_error: [googleError, googleDropError].filter(Boolean).join(' | ') || null,
    phase1_pickups: {
      optimizedIntermediateWaypointIndex: optimizedIdx ?? [],
    },
    phase2_dropoffs: {
      optimizedIntermediateWaypointIndex: optimizedDropIdx,
      degraded: degradedDrop,
      error: googleDropError ?? null,
    },
    mixed_sequence: true,
    optimized_at: new Date().toISOString(),
  };

  const { error: metaErr } = await service
    .from('demand_route_groups')
    .update({ optimization_meta: meta })
    .eq('id', groupId);
  if (metaErr) {
    return { groupId, ok: false, error: metaErr.message };
  }

  if (degradedAny) {
    console.warn('[hex-google]', groupId, googleError, googleDropError);
  }

  return {
    groupId,
    ok: true,
    degraded: degradedAny,
    legs,
    googleOptimizedIntermediateWaypointIndex: optimizedIdx ?? [],
    googleDropoffIntermediateWaypointIndex: optimizedDropIdx.length ? optimizedDropIdx : undefined,
  };
}

/**
 * Tras `auto_group_hex_trip_requests_v3`: Fase 1 Google reordena pickups; Fase 2 Google reordena bajadas
 * (tras la última subida), manteniendo todas las bajadas después de todas las subidas.
 */
export async function runHexGroupingGooglePass(
  service: SupabaseClient,
  groupIds: string[]
): Promise<{ ok: boolean; results: HexGroupOptimizeResult[] }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    const results: HexGroupOptimizeResult[] = groupIds.map((groupId) => ({
      groupId,
      ok: false,
      degraded: true,
      error: 'Falta GOOGLE_MAPS_API_KEY',
    }));
    for (const gid of groupIds) {
      await service
        .from('demand_route_groups')
        .update({
          optimization_meta: {
            engine: 'hex_naive_fifo_degraded',
            degraded: true,
            google_error: 'Falta GOOGLE_MAPS_API_KEY',
            optimized_at: new Date().toISOString(),
          },
        })
        .eq('id', gid);
    }
    return { ok: false, results };
  }

  const results: HexGroupOptimizeResult[] = [];
  for (const gid of groupIds) {
    results.push(await optimizeOneHexGroup(service, apiKey, gid));
  }
  const ok = results.every((r) => r.ok);
  return { ok, results };
}
