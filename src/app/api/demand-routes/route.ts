import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/demand-routes
 * Lista rutas con demanda agrupadas (para conductor y pasajero).
 * Query: origin_city?, destination_city?, requested_date_from?, requested_date_to?
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await authGetUser(supabase, request);

    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const originCity = searchParams.get('origin_city')?.trim() || undefined;
    const destinationCity = searchParams.get('destination_city')?.trim() || undefined;
    const dateFrom = searchParams.get('requested_date_from')?.trim() || undefined;
    const dateTo = searchParams.get('requested_date_to')?.trim() || undefined;

    const service = createServiceClient();

    let q = service
      .from('demand_route_groups')
      .select('id, ride_id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, created_at')
      .order('requested_date', { ascending: true })
      .order('requested_time', { ascending: true });

    if (originCity) q = q.ilike('origin_city', `%${originCity}%`);
    if (destinationCity) q = q.ilike('destination_city', `%${destinationCity}%`);
    if (dateFrom) q = q.gte('requested_date', dateFrom);
    if (dateTo) q = q.lte('requested_date', dateTo);

    const { data: groups, error } = await q;

    if (error) {
      console.error('demand-routes list error:', error);
      return NextResponse.json({ error: 'No se pudieron obtener las rutas de demanda.' }, { status: 500 });
    }

    const rows = groups ?? [];
    const groupIds = rows.map((g) => g.id);
    const rideIdByGroupId = new Map<string, string>();
    for (const g of rows) {
      const gid = String((g as { id?: string | null }).id ?? '').trim();
      const rid = (g as { ride_id?: string | null }).ride_id;
      if (gid && rid) rideIdByGroupId.set(gid, String(rid));
    }
    let seatsByGroup: Record<string, number> = {};
    let passengersByGroup: Record<string, number> = {};
    if (groupIds.length > 0) {
      const { data: linked } = await service
        .from('trip_requests')
        .select('demand_group_id, seats, status, ride_id')
        .in('demand_group_id', groupIds)
        .in('status', ['grouped', 'group_linked_pending', 'accepted']);
      for (const tr of linked ?? []) {
        const gid = String(tr.demand_group_id ?? '');
        if (!gid) continue;
        const st = String((tr as { status?: string }).status ?? '');
        const expectedRide = rideIdByGroupId.get(gid);
        if (st === 'accepted' && (!expectedRide || String((tr as { ride_id?: string | null }).ride_id ?? '') !== expectedRide)) {
          continue;
        }
        passengersByGroup[gid] = (passengersByGroup[gid] ?? 0) + 1;
        seatsByGroup[gid] = (seatsByGroup[gid] ?? 0) + (Number.isFinite(Number(tr.seats)) ? Number(tr.seats) : 1);
      }
    }

    const enriched = rows.map((g) => {
      const groupedSeatsTaken = seatsByGroup[g.id] ?? 0;
      const groupedPassengerCount = passengersByGroup[g.id] ?? 0;
      const groupedSeatsCapacity = 15;
      return {
        ...g,
        grouped_passenger_count: groupedPassengerCount,
        grouped_seats_taken: groupedSeatsTaken,
        grouped_seats_capacity: groupedSeatsCapacity,
        grouped_seats_available: Math.max(0, groupedSeatsCapacity - groupedSeatsTaken),
      };
    });

    return NextResponse.json({ groups: enriched });
  } catch (e) {
    console.error('demand-routes GET error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
