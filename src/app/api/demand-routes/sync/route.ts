import { NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import {
  distancePointToPolylineMeters,
  getPositionAlongPolyline,
} from '@/lib/geo';
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
    const p1 = points[i];
    const p2 = points[i + 1];
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lng - p1.lng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(p1.lat)) *
        Math.cos(toRad(p2.lat)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    m += R * c;
  }
  return m / 1000;
}

async function fetchOsrmPolyline(
  origin: Point,
  destination: Point
): Promise<Point[]> {
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

/**
 * POST /api/demand-routes/sync
 * Recomputa grupos: pending trip_requests sin grupo → obtiene polyline si falta, agrupa por fecha/hora/ciudad/corredor 2km, crea demand_route_groups y demand_route_members.
 * Requiere usuario autenticado con rol driver o admin (o cron con DEMAND_ROUTES_SYNC_SECRET).
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    const cronSecret = process.env.DEMAND_ROUTES_SYNC_SECRET;
    const useCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!useCron) {
      const server = createServerClient(request);
      const { data: { user }, error: authError } = await server.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
      const { data: profile } = await server.from('profiles').select('role').eq('id', user.id).single();
      if (!profile || !['driver', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Solo conductor o admin pueden ejecutar sync' }, { status: 403 });
      }
    }

    const supabase = createServiceClient();

    const { data: alreadyInGroup } = await supabase
      .from('demand_route_members')
      .select('trip_request_id');
    const assignedIds = new Set(
      (alreadyInGroup ?? []).map((r) => r.trip_request_id)
    );

    const { data: pending, error: pendingError } = await supabase
      .from('trip_requests')
      .select(
        'id, origin_lat, origin_lng, destination_lat, destination_lng, requested_date, requested_time, origin_city, destination_city, origin_department, destination_department, origin_barrio, destination_barrio, route_polyline, route_length_km'
      )
      .eq('status', 'pending')
      .not('origin_lat', 'is', null)
      .not('destination_lat', 'is', null);

    if (pendingError) {
      console.error('demand-routes sync pending error:', pendingError);
      return NextResponse.json(
        { error: pendingError.message },
        { status: 500 }
      );
    }

    const unassigned = (pending ?? []).filter((r) => !assignedIds.has(r.id));
    if (unassigned.length === 0) {
      return NextResponse.json({ ok: true, message: 'Nada que agrupar' });
    }

    for (const r of unassigned) {
      let polyline = Array.isArray(r.route_polyline)
        ? (r.route_polyline as Point[])
        : null;
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
        (r as any).route_polyline = polyline;
        (r as any).route_length_km = lengthKm;
      } else {
        (r as any).route_length_km =
          r.route_length_km ?? polylineLengthKm(polyline);
      }
    }

    const withPolyline = unassigned.map((r) => ({
      ...r,
      route_polyline: (r as any).route_polyline as Point[],
      route_length_km: (r as any).route_length_km as number,
    }));

    const sorted = [...withPolyline].sort(
      (a, b) => (b.route_length_km ?? 0) - (a.route_length_km ?? 0)
    );

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
        if (!timeWithinWindow(timeToMinutes(g.requested_time), reqTimeMin))
          continue;
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
        if (!timeWithinWindow(timeToMinutes(g.requested_time), reqTimeMin))
          continue;
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

    return NextResponse.json({
      ok: true,
      processed: unassigned.length,
      addedToExisting,
      newGroupsCreated: newGroups.length,
    });
  } catch (e) {
    console.error('demand-routes sync error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
