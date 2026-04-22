import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import {
  dedupeDemandRouteLegsForUi,
  dedupeDemandRouteMemberRows,
} from '@/lib/demand-route-members-dedupe';
import { baseFareFromDistanceKmWithPricing } from '@/lib/pricing/segment-fare';
import { computeGoogleDrivingRoute } from '@/lib/google-routes-polyline';

type Point = { lat: number; lng: number };

function toPoint(lat: number | null | undefined, lng: number | null | undefined): Point | null {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return { lat: Number(lat), lng: Number(lng) };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

async function fetchGoogleRoute(origin: Point, destination: Point, waypoints: Point[]): Promise<Point[] | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;
  const route = await computeGoogleDrivingRoute(apiKey, origin, destination, waypoints);
  if (!route || !Array.isArray(route.polyline) || route.polyline.length < 2) return null;
  return route.polyline;
}

/**
 * GET /api/demand-routes/[id]
 * Detalle de una ruta agrupada: polyline base + puntos de pasajeros + legs ordenados (Sube/Baja).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await authGetUser(supabase, request);

    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    }

    const service = createServiceClient();
    const { data: group, error: groupError } = await service
      .from('demand_route_groups')
      .select('id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, destination_city, passenger_count, ride_id')
      .eq('id', id)
      .single();

    if (groupError || !group) {
      return NextResponse.json({ error: 'Grupo no encontrado' }, { status: 404 });
    }

    const { data: members, error: membersError } = await service
      .from('demand_route_members')
      .select('trip_request_id, stop_type, visit_order')
      .eq('group_id', id);

    if (membersError) {
      console.error('demand-routes detail members error:', membersError);
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    const requestIds = (members ?? []).map((m) => m.trip_request_id).filter(Boolean);
    let passengers: Array<{
      trip_request_id: string;
      user_id: string;
      seats: number;
      origin_lat: number;
      origin_lng: number;
      origin_label: string | null;
      destination_lat: number;
      destination_lng: number;
      destination_label: string | null;
    }> = [];

    let legs: Array<{
      visit_order: number;
      stop_type: 'PICKUP' | 'DROPOFF' | 'LEGACY';
      trip_request_id: string;
      passenger_name: string;
      label: string;
      action: string;
      fare_amount: number | null;
      lat: number | null;
      lng: number | null;
    }> = [];
    let totalToCollectFromRequests = 0;

    {
      const { data: linkedByGroup } = await service
        .from('trip_requests')
        .select(
          'id, user_id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, passenger_desired_price_per_seat_gs, seats, status, demand_group_id, ride_id'
        )
        .eq('demand_group_id', id);

      let linkedByMembers:
        | Array<{
            id: string;
            user_id: string;
            origin_lat: number;
            origin_lng: number;
            origin_label: string | null;
            destination_lat: number;
            destination_lng: number;
            destination_label: string | null;
            passenger_desired_price_per_seat_gs: number | null;
            seats: number;
            status: string;
            demand_group_id: string | null;
            ride_id: string | null;
          }>
        | null = null;
      if (requestIds.length > 0) {
        const { data } = await service
          .from('trip_requests')
          .select(
            'id, user_id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, passenger_desired_price_per_seat_gs, seats, status, demand_group_id, ride_id'
          )
          .in('id', requestIds);
        linkedByMembers = data;
      }

      const mergedById = new Map<string, NonNullable<typeof linkedByGroup>[number]>();
      for (const r of linkedByGroup ?? []) mergedById.set(String(r.id), r);
      for (const r of linkedByMembers ?? []) mergedById.set(String(r.id), r);
      let requests = Array.from(mergedById.values());
      if (requestIds.length > 0) {
        const memberTripIds = new Set(requestIds.map((rid) => String(rid)));
        requests = requests.filter((r) => memberTripIds.has(String(r.id)));
      }
      const reqError = null;

      if (!reqError && requests) {
        passengers = requests.map((r) => ({
          trip_request_id: r.id,
          user_id: r.user_id,
          seats: Number.isFinite(Number(r.seats)) ? Number(r.seats) : 1,
          origin_lat: r.origin_lat,
          origin_lng: r.origin_lng,
          origin_label: r.origin_label ?? null,
          destination_lat: r.destination_lat,
          destination_lng: r.destination_lng,
          destination_label: r.destination_label ?? null,
        }));

        const userIds = Array.from(
          new Set(
            requests
              .map((r) => String(r.user_id ?? '').trim())
              .filter((x) => x.length > 0)
          )
        );
        const nameByUser: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profs } = await service
            .from('profiles')
            .select('id, full_name')
            .in('id', userIds);
          for (const p of profs ?? []) {
            const pid = String(p.id ?? '');
            const nm = String(p.full_name ?? '').trim();
            if (pid) nameByUser[pid] = nm || `Pasajero ${pid.slice(0, 6)}`;
          }
        }

        const byReq: Record<
          string,
          {
            user_id: string;
            origin_label: string | null;
            destination_label: string | null;
            origin_lat: number;
            origin_lng: number;
            destination_lat: number;
            destination_lng: number;
            fare_amount: number | null;
            seats: number;
          }
        > = {};
        for (const r of requests) {
          byReq[String(r.id)] = {
            user_id: String(r.user_id ?? ''),
            origin_label: r.origin_label ?? null,
            destination_label: r.destination_label ?? null,
            origin_lat: Number(r.origin_lat),
            origin_lng: Number(r.origin_lng),
            destination_lat: Number(r.destination_lat),
            destination_lng: Number(r.destination_lng),
            fare_amount:
              r.passenger_desired_price_per_seat_gs != null &&
              Number.isFinite(Number(r.passenger_desired_price_per_seat_gs))
                ? Number(r.passenger_desired_price_per_seat_gs)
                : null,
            seats: Number.isFinite(Number(r.seats)) ? Number(r.seats) : 1,
          };
        }
        totalToCollectFromRequests = requests.reduce((sum, r) => {
          const perSeat = Number(r.passenger_desired_price_per_seat_gs ?? 0);
          const seats = Number.isFinite(Number(r.seats)) ? Math.max(1, Number(r.seats)) : 1;
          return sum + (Number.isFinite(perSeat) ? Math.max(0, perSeat) * seats : 0);
        }, 0);

        const { data: activePricing } = await service
          .from('pricing_settings')
          .select('min_fare_100, pyg_per_km_100, discount_percent, round_to, block_size, block_multiplier, min_fare_floor_pyg')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        const discount = 1 - Number(activePricing?.discount_percent ?? 0) / 100;
        const roundTo = Math.max(1, Number(activePricing?.round_to ?? 100));
        const minFareComputed = Math.round((Number(activePricing?.min_fare_100 ?? 10000) * discount) / roundTo) * roundTo;
        const minFarePyg = Math.max(
          Math.max(0, Number(activePricing?.min_fare_floor_pyg ?? 10000)),
          minFareComputed
        );
        const pygPerKm = Math.round((Number(activePricing?.pyg_per_km_100 ?? 2780) * discount) / roundTo) * roundTo;

        const memberRowsRaw = (members ?? []).filter((m) => requests.some((r) => r.id === m.trip_request_id));
        const memberRows = dedupeDemandRouteMemberRows(memberRowsRaw);
        const byVisitKey = new Set<string>();
        for (const m of memberRows) {
          byVisitKey.add(`${m.trip_request_id}|${String(m.stop_type ?? 'LEGACY').toUpperCase()}`);
        }
        const maxVisit = memberRows.reduce((mx, m) => Math.max(mx, Number(m.visit_order ?? 0)), 0);
        const syntheticRows = requests.flatMap((r, idx) => {
          const pickupKey = `${r.id}|PICKUP`;
          const dropoffKey = `${r.id}|DROPOFF`;
          const base = maxVisit + idx * 2 + 1;
          return [
            ...(byVisitKey.has(pickupKey) ? [] : [{ trip_request_id: r.id, stop_type: 'PICKUP', visit_order: base }]),
            ...(byVisitKey.has(dropoffKey) ? [] : [{ trip_request_id: r.id, stop_type: 'DROPOFF', visit_order: base + 1 }]),
          ];
        });
        const membersOrSynthetic = [...memberRows, ...syntheticRows];

        legs = membersOrSynthetic
          .map((m) => {
            const reqId = String(m.trip_request_id ?? '');
            const req = byReq[reqId];
            if (!req) return null;
            const stRaw = String(m.stop_type ?? 'LEGACY').toUpperCase();
            const st: 'PICKUP' | 'DROPOFF' | 'LEGACY' =
              stRaw === 'PICKUP' || stRaw === 'DROPOFF' ? stRaw : 'LEGACY';
            const passengerName =
              nameByUser[req.user_id] || `Pasajero ${req.user_id?.slice(0, 6) || reqId.slice(0, 6)}`;
            const label = st === 'DROPOFF' ? req.destination_label ?? 'Destino' : req.origin_label ?? 'Origen';
            const lat = st === 'DROPOFF' ? req.destination_lat : req.origin_lat;
            const lng = st === 'DROPOFF' ? req.destination_lng : req.origin_lng;
            const action = st === 'DROPOFF' ? `Baja ${passengerName}` : `Sube ${passengerName}`;
            const fallbackFare =
              req.origin_lat != null &&
              req.origin_lng != null &&
              req.destination_lat != null &&
              req.destination_lng != null
                ? baseFareFromDistanceKmWithPricing(
                    Math.max(
                      0.5,
                      haversineKm(
                        Number(req.origin_lat),
                        Number(req.origin_lng),
                        Number(req.destination_lat),
                        Number(req.destination_lng)
                      ) * 1.2
                    ),
                    {
                      minFarePyg,
                      pygPerKm,
                      roundTo,
                      blockSize: Number(activePricing?.block_size ?? 4),
                      blockMultiplier: Number(activePricing?.block_multiplier ?? 1.5),
                      pricingSettingsId: null,
                    }
                  )
                : null;
            const seatsCount = Number.isFinite(Number(req.seats)) ? Math.max(1, Number(req.seats)) : 1;
            const explicitPerSeat =
              req.fare_amount != null && Number.isFinite(Number(req.fare_amount)) ? Number(req.fare_amount) : null;
            const pickupTotalGs =
              st === 'PICKUP'
                ? explicitPerSeat != null
                  ? Math.round(Math.max(0, explicitPerSeat) * seatsCount)
                  : fallbackFare != null && Number.isFinite(Number(fallbackFare))
                    ? Math.round(Math.max(0, Number(fallbackFare)))
                    : null
                : null;
            return {
              visit_order: Number(m.visit_order ?? 0),
              stop_type: st,
              trip_request_id: reqId,
              passenger_name: passengerName,
              label,
              action,
              fare_amount: st === 'PICKUP' ? pickupTotalGs : null,
              lat: Number.isFinite(lat) ? lat : null,
              lng: Number.isFinite(lng) ? lng : null,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null)
          .sort((a, b) => a.visit_order - b.visit_order);

        legs = dedupeDemandRouteLegsForUi(legs);
      }
    }

    const { data: pricingRow } = await createServiceClient()
      .from('pricing_settings')
      .select('driver_fee_percent_of_collected')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const driverFeePercent = Math.max(
      0,
      Math.min(100, Number(pricingRow?.driver_fee_percent_of_collected ?? 10))
    );
    const totalToCollectGs = totalToCollectFromRequests;
    const groupedSeatsTaken = passengers.reduce(
      (sum, p) => sum + (Number.isFinite(Number(p.seats)) ? Number(p.seats) : 1),
      0
    );
    const groupedSeatsCapacity = 15;
    const groupedSeatsAvailable = Math.max(0, groupedSeatsCapacity - groupedSeatsTaken);
    const driverFeeGs = Math.round((totalToCollectGs * driverFeePercent) / 100);
    const driverNetEarningsGs = Math.max(0, totalToCollectGs - driverFeeGs);

    const orderedStops = legs
      .map((l) => toPoint(l.lat, l.lng))
      .filter((p): p is Point => p != null);
    const routePolyline =
      orderedStops.length >= 2
        ? await fetchGoogleRoute(
            orderedStops[0]!,
            orderedStops[orderedStops.length - 1]!,
            orderedStops.slice(1, -1)
          )
        : null;

    return NextResponse.json({
      id: group.id,
      base_trip_request_id: group.base_trip_request_id ?? null,
      base_polyline: routePolyline ?? group.base_polyline,
      route_polyline: routePolyline ?? group.base_polyline,
      base_length_km: group.base_length_km,
      requested_date: group.requested_date,
      requested_time: group.requested_time,
      origin_city: group.origin_city,
      destination_city: group.destination_city,
      passenger_count: passengers.length,
      ride_id: group.ride_id ?? null,
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
    });
  } catch (e) {
    console.error('demand-routes [id] GET error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
