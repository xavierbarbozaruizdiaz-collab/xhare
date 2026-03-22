/**
 * Rides API: my rides (driver), search (passenger), detail, booked seats.
 * Aligned with web app Supabase queries and RPCs.
 */
import { supabase } from '../backend/supabase';

export async function fetchMyRides(driverId: string) {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', driverId)
    .order('departure_time', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Reserved seats and total amount per ride (for driver list). */
export async function fetchBookingsAggregate(rideIds: string[]) {
  if (rideIds.length === 0) return { reservedByRide: {} as Record<string, number>, amountByRide: {} as Record<string, number> };
  const { data, error } = await supabase
    .from('bookings')
    .select('ride_id, seats_count, price_paid')
    .in('ride_id', rideIds)
    .neq('status', 'cancelled');
  if (error) throw error;
  const reservedByRide: Record<string, number> = {};
  const amountByRide: Record<string, number> = {};
  (data ?? []).forEach((b: { ride_id: string; seats_count?: number; price_paid?: number }) => {
    const rid = b.ride_id;
    reservedByRide[rid] = (reservedByRide[rid] ?? 0) + Number(b.seats_count ?? 0);
    amountByRide[rid] = (amountByRide[rid] ?? 0) + Number(b.price_paid ?? 0);
  });
  return { reservedByRide, amountByRide };
}

/** Cancel a booking (passenger only). */
export async function cancelBooking(bookingId: string, passengerId: string) {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .eq('passenger_id', passengerId);
  if (error) throw error;
}

/** Search published rides (passenger). Optional date, origin, destination (label match), seats, maxPrice. */
export async function searchRides(options: {
  date?: string;
  origin?: string;
  destination?: string;
  seats?: number;
  maxPrice?: number | string;
}) {
  const { date, origin, destination, seats = 1, maxPrice } = options;
  let query = supabase
    .from('rides')
    .select(`
      *,
      driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count),
      ride_stops(*)
    `)
    .eq('status', 'published');

  const now = new Date();
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    query = query
      .gte('departure_time', start.toISOString())
      .lte('departure_time', end.toISOString());
  } else {
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    endDate.setHours(23, 59, 59, 999);
    query = query
      .gte('departure_time', now.toISOString())
      .lte('departure_time', endDate.toISOString());
  }

  const { data, error } = await query.order('departure_time', { ascending: true }).limit(150);
  if (error) throw error;
  let list = (data ?? []).filter(
    (r: { status: string; departure_time?: string }) =>
      r.status === 'published' && r.departure_time && new Date(r.departure_time) > now
  );

  const rideIds = list.map((r: { id: string }) => r.id);
  const bookedByRide: Record<string, number> = {};
  if (rideIds.length > 0) {
    const { data: seatData } = await supabase.rpc('get_ride_booked_seats', { ride_ids: rideIds });
    if (Array.isArray(seatData)) {
      seatData.forEach((row: { ride_id: string; booked_seats?: number }) => {
        bookedByRide[row.ride_id] = Number(row.booked_seats ?? 0);
      });
    }
  }

  const totalSeats = (r: { total_seats?: number; available_seats?: number }) =>
    Number(r.total_seats ?? r.available_seats ?? 15);
  list = list
    .map((r: Record<string, unknown> & { id: string }) => {
      const booked = bookedByRide[r.id];
      const remaining =
        booked !== undefined
          ? Math.max(0, totalSeats(r as { total_seats?: number; available_seats?: number }) - booked)
          : Math.max(0, Number(r.available_seats ?? totalSeats(r as { total_seats?: number; available_seats?: number })));
      return { ...r, available_seats: remaining };
    })
    .filter((r: { available_seats: number }) => r.available_seats >= seats);

  if (origin?.trim()) {
    const o = origin.trim().toLowerCase();
    list = list.filter(
      (r: { origin_label?: string | null }) => (r.origin_label ?? '').toLowerCase().includes(o)
    );
  }
  if (destination?.trim()) {
    const d = destination.trim().toLowerCase();
    list = list.filter(
      (r: { destination_label?: string | null }) => (r.destination_label ?? '').toLowerCase().includes(d)
    );
  }

  const max = typeof maxPrice === 'string' ? parseFloat(maxPrice) : maxPrice;
  if (typeof max === 'number' && !Number.isNaN(max) && max > 0) {
    list = list.filter((r: { price_per_seat?: number | null }) => Number(r.price_per_seat ?? 0) <= max);
  }

  return list;
}

/** Ride detail for a user (driver or passenger). Returns ride + driver + ride_stops. */
export async function fetchRideDetail(rideId: string) {
  const { data: rpcData, error } = await supabase.rpc('get_ride_detail_for_user', {
    p_ride_id: rideId,
  });
  if (error) throw error;
  const raw = Array.isArray(rpcData) && rpcData.length > 0 ? rpcData[0] : rpcData;
  if (!raw || typeof raw !== 'object' || !(raw as { ride?: unknown }).ride) return null;
  const r = raw as {
    ride: Record<string, unknown>;
    ride_stops?: unknown[];
    driver_profile?: Record<string, unknown> | null;
  };
  return {
    ...r.ride,
    driver: r.driver_profile ?? null,
    ride_stops: Array.isArray(r.ride_stops) ? r.ride_stops : [],
  };
}

export type RideStopForReserve = {
  id: string;
  lat: number;
  lng: number;
  label: string | null;
  stop_order: number;
};

/**
 * Ride with ride_stops for the reserve screen. Uses direct select so any authenticated
 * user can load a published ride and its stops (RLS: published rides + "view stops for published").
 */
export async function fetchRideForReserve(rideId: string): Promise<{
  ride: Record<string, unknown>;
  ride_stops: RideStopForReserve[];
} | null> {
  const { data: rideRow, error: rideError } = await supabase
    .from('rides')
    .select(`
      id, driver_id, status, available_seats, total_seats, price_per_seat,
      origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label,
      departure_time, base_route_polyline, max_deviation_km,
      description, estimated_duration_minutes, flexible_departure, started_at,
      current_stop_index, awaiting_stop_confirmation,
      driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count),
      ride_stops(id, lat, lng, label, stop_order)
    `)
    .eq('id', rideId)
    .maybeSingle();
  if (rideError || !rideRow) return null;
  const ride = rideRow as Record<string, unknown>;
  let stops: RideStopForReserve[] = [];
  const rawStops = ride.ride_stops;
  if (Array.isArray(rawStops) && rawStops.length > 0) {
    stops = rawStops
      .filter((s: unknown) => s && typeof s === 'object')
      .map((s: Record<string, unknown>) => ({
        id: String(s.id ?? ''),
        lat: Number(s.lat),
        lng: Number(s.lng),
        label: s.label != null ? String(s.label) : null,
        stop_order: Number(s.stop_order ?? 0),
      }))
      .sort((a, b) => a.stop_order - b.stop_order);
  }
  if (stops.length === 0) {
    const { data: stopsData } = await supabase
      .from('ride_stops')
      .select('id, lat, lng, label, stop_order')
      .eq('ride_id', rideId)
      .order('stop_order', { ascending: true });
    if (stopsData?.length) {
      stops = stopsData as RideStopForReserve[];
    }
  }
  const rideClean = { ...ride };
  delete rideClean.ride_stops;
  return { ride: rideClean, ride_stops: stops };
}

/** Bookings for a ride (non-cancelled). With pickup/dropoff stop for arrive flow. */
export async function fetchRideBookings(rideId: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, passenger_id, seats_count, status, pickup_stop_id, dropoff_stop_id')
    .eq('ride_id', rideId)
    .neq('status', 'cancelled');
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    passenger_id: string;
    seats_count?: number;
    status: string;
    pickup_stop_id?: string | null;
    dropoff_stop_id?: string | null;
  }>;
}

/** Public info: booked_seats and pickups/dropoffs (for map). */
export async function fetchRidePublicInfo(rideId: string) {
  const { data, error } = await supabase.rpc('get_ride_public_info', { p_ride_id: rideId });
  if (error) return null;
  const row = Array.isArray(data) && data[0] ? data[0] : data;
  return row as { booked_seats: number; pickups?: Array<{ lat: number; lng: number; label?: string }>; dropoffs?: Array<{ lat: number; lng: number; label?: string }> } | null;
}

/** Save trip request (passenger): when no rides match, save origin/destination/date for drivers to see. */
export async function saveTripRequest(params: {
  userId: string;
  originLat: number;
  originLng: number;
  originLabel: string;
  destinationLat: number;
  destinationLng: number;
  destinationLabel: string;
  requestedDate: string;
  requestedTime: string;
  seats?: number;
  originCity?: string | null;
  originDepartment?: string | null;
  originBarrio?: string | null;
  destinationCity?: string | null;
  destinationDepartment?: string | null;
  destinationBarrio?: string | null;
  routePolyline?: Array<{ lat: number; lng: number }> | null;
  routeLengthKm?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const row: Record<string, unknown> = {
    user_id: params.userId,
    origin_lat: params.originLat,
    origin_lng: params.originLng,
    origin_label: params.originLabel.slice(0, 500),
    destination_lat: params.destinationLat,
    destination_lng: params.destinationLng,
    destination_label: params.destinationLabel.slice(0, 500),
    requested_date: params.requestedDate,
    requested_time: params.requestedTime,
    seats: Math.max(1, Math.min(50, params.seats ?? 1)),
    status: 'pending',
  };
  if (params.originCity != null) row.origin_city = params.originCity;
  if (params.originDepartment != null) row.origin_department = params.originDepartment;
  if (params.originBarrio != null) row.origin_barrio = params.originBarrio;
  if (params.destinationCity != null) row.destination_city = params.destinationCity;
  if (params.destinationDepartment != null) row.destination_department = params.destinationDepartment;
  if (params.destinationBarrio != null) row.destination_barrio = params.destinationBarrio;
  if (params.routePolyline != null && params.routePolyline.length > 0) row.route_polyline = params.routePolyline;
  if (params.routeLengthKm != null) row.route_length_km = params.routeLengthKm;
  const { error } = await supabase.from('trip_requests').insert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** My trip requests (passenger). */
export async function fetchMyTripRequests(userId: string) {
  const { data, error } = await supabase
    .from('trip_requests')
    .select('id, origin_label, destination_label, requested_date, requested_time, seats, status, ride_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

/** Cancel a pending trip request (passenger). */
export async function cancelTripRequest(requestId: string, userId: string) {
  const { error } = await supabase
    .from('trip_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('user_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
}

/** My bookings (passenger). */
export async function fetchMyBookings(passengerId: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `
      id, ride_id, seats_count, price_paid, status, pickup_label, dropoff_label,
      ride:rides(
        id, origin_label, destination_label, departure_time, price_per_seat,
        driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
      )
    `
    )
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}
