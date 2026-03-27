/**
 * Rides API: my rides (driver), search (passenger), detail, booked seats.
 * Aligned with web app Supabase queries and RPCs.
 */
import { supabase } from '../backend/supabase';
import { env } from '../core/env';
import { raceWithTimeout } from '../backend/withTimeout';
import { distanceMeters, distancePointToPolylineMeters, type Point } from '../lib/geo';

const SUPABASE_QUERY_TIMEOUT_MS = 28_000;
const SAVE_TRIP_REQUEST_INSERT_TIMEOUT_MS = 22_000;
/** Guardar vía Next (misma URL que geocode/OSRM): en emulador Android suele ser más fiable que REST directo a Supabase. */
const SAVE_TRIP_REQUEST_API_TIMEOUT_MS = 28_000;

function normalizeSearchText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Coincidencia más estricta: frase completa o ≥70% de palabras significativas (≥3 letras). */
function labelMatchesSearchText(label: string, query: string): boolean {
  const l = normalizeSearchText(label);
  const qRaw = normalizeSearchText(query);
  if (!qRaw) return true;
  if (l.includes(qRaw)) return true;
  const tokens = qRaw.split(/\s+/).filter((t) => t.length >= 2);
  const sig = tokens.filter((t) => t.length >= 3);
  if (sig.length === 0) return l.includes(qRaw);
  const matched = sig.filter((t) => l.includes(t)).length;
  return matched >= Math.max(1, Math.ceil(sig.length * 0.7));
}

function textMatchStrength(label: string, query: string): number {
  const l = normalizeSearchText(label);
  const qRaw = normalizeSearchText(query);
  if (!qRaw) return 0;
  let score = l.includes(qRaw) ? 1000 : 0;
  const tokens = qRaw.split(/\s+/).filter((t) => t.length >= 3);
  for (const t of tokens) {
    if (l.includes(t)) score += 100;
    const idx = l.indexOf(t);
    if (idx >= 0) score += Math.max(0, 50 - idx);
  }
  return score;
}

function parseRideBasePolyline(ride: Record<string, unknown>): Point[] {
  const raw = ride.base_route_polyline;
  if (!Array.isArray(raw)) return [];
  const out: Point[] = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && 'lat' in p && 'lng' in p) {
      const lat = Number((p as { lat: unknown }).lat);
      const lng = Number((p as { lng: unknown }).lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
  }
  return out;
}

/** Distancia del punto del usuario al “donde podría subir”: min(origen publicado, corredor de la ruta). */
function metersUserToRidePickupRegion(ride: Record<string, unknown>, user: Point): number {
  const poly = parseRideBasePolyline(ride);
  const olat = Number(ride.origin_lat);
  const olng = Number(ride.origin_lng);
  const toOrigin =
    Number.isFinite(olat) && Number.isFinite(olng) ? distanceMeters(user, { lat: olat, lng: olng }) : Infinity;
  if (poly.length >= 2) {
    return Math.min(toOrigin, distancePointToPolylineMeters(user, poly));
  }
  return toOrigin;
}

/** Distancia del punto del usuario al “donde podría bajar”: min(destino publicado, corredor de la ruta). */
function metersUserToRideDropoffRegion(ride: Record<string, unknown>, user: Point): number {
  const poly = parseRideBasePolyline(ride);
  const dlat = Number(ride.destination_lat);
  const dlng = Number(ride.destination_lng);
  const toDest =
    Number.isFinite(dlat) && Number.isFinite(dlng) ? distanceMeters(user, { lat: dlat, lng: dlng }) : Infinity;
  if (poly.length >= 2) {
    return Math.min(toDest, distancePointToPolylineMeters(user, poly));
  }
  return toDest;
}

export async function fetchMyRides(driverId: string) {
  const q = supabase
    .from('rides')
    .select('*')
    .eq('driver_id', driverId)
    .order('departure_time', { ascending: false })
    .limit(100);
  const { data, error } = await raceWithTimeout(
    q,
    SUPABASE_QUERY_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: { message: 'SUPABASE_QUERY_TIMEOUT', details: '', hint: '', code: 'TIMEOUT' },
      }) as Awaited<typeof q>
  );
  if (error?.message === 'SUPABASE_QUERY_TIMEOUT') {
    throw new Error('Tiempo de espera al cargar tus viajes. Revisá la conexión.');
  }
  if (error) throw error;
  return data ?? [];
}

/** Reserved seats and total amount per ride (for driver list). */
export async function fetchBookingsAggregate(rideIds: string[]) {
  if (rideIds.length === 0) return { reservedByRide: {} as Record<string, number>, amountByRide: {} as Record<string, number> };
  const q = supabase
    .from('bookings')
    .select('ride_id, seats_count, price_paid')
    .in('ride_id', rideIds)
    .neq('status', 'cancelled');
  const { data, error } = await raceWithTimeout(
    q,
    SUPABASE_QUERY_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: { message: 'SUPABASE_QUERY_TIMEOUT', details: '', hint: '', code: 'TIMEOUT' },
      }) as Awaited<typeof q>
  );
  if (error?.message === 'SUPABASE_QUERY_TIMEOUT') {
    throw new Error('Tiempo de espera al cargar reservas. Revisá la conexión.');
  }
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

/** YYYY-MM-DD → inicio y fin de ese día calendario en zona local (evita desfase UTC de `new Date("YYYY-MM-DD")`). */
function localDayBounds(ymd: string): { start: Date; end: Date } | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) return null;
  return { start, end };
}

/** Si viene `HH:MM` (24 h), ajusta la hora de inicio del rango ese mismo día. Sin valor = desde 00:00. */
function applyOptionalFromTime(dayStart: Date, fromTimeLocal?: string): Date {
  const t = fromTimeLocal?.trim();
  if (!t) return dayStart;
  const p = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!p) return dayStart;
  const hh = Math.min(23, Math.max(0, parseInt(p[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(p[2], 10)));
  const out = new Date(dayStart.getTime());
  out.setHours(hh, mm, 0, 0);
  return out;
}

export type NearPointFilter = { lat: number; lng: number; /** default 22 */ radiusKm?: number };

/** Search published rides (passenger). Optional date, origin, destination (label match), seats, maxPrice. */
export async function searchRides(options: {
  date?: string;
  /** Solo con `date`. Hora local HH:MM desde la cual (hasta fin del día). Omitir = todo el día. */
  fromTimeLocal?: string;
  origin?: string;
  destination?: string;
  /** Si viene, filtra por proximidad al origen del viaje (metros); no combina con `origin` texto en el mismo eje. */
  originNear?: NearPointFilter;
  destinationNear?: NearPointFilter;
  seats?: number;
  maxPrice?: number | string;
}) {
  const { date, fromTimeLocal, origin, destination, originNear, destinationNear, seats = 1, maxPrice } = options;
  // Sin join a `profiles`: la policy solo permite ver otros perfiles a `authenticated`;
  // con sesión anónima el embed falla y la query puede venir vacía o sin filas útiles.
  let query = supabase
    .from('rides')
    .select(`*, ride_stops(*)`)
    .eq('status', 'published');

  const now = new Date();
  const bounds = date?.trim() ? localDayBounds(date) : null;
  if (bounds) {
    let rangeStart = applyOptionalFromTime(bounds.start, fromTimeLocal);
    const rangeEnd = bounds.end;
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      rangeStart = bounds.start;
    }
    query = query
      .gte('departure_time', rangeStart.toISOString())
      .lte('departure_time', rangeEnd.toISOString());
  } else {
    // Sin fecha: próximos viajes publicados (ventana amplia; el listado no debe quedar vacío por un tope corto).
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 365);
    endDate.setHours(23, 59, 59, 999);
    query = query
      .gte('departure_time', now.toISOString())
      .lte('departure_time', endDate.toISOString());
  }

  const ridesListQuery = query.order('departure_time', { ascending: true }).limit(220);
  const { data, error } = await raceWithTimeout(
    ridesListQuery,
    SUPABASE_QUERY_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: { message: 'SUPABASE_QUERY_TIMEOUT', details: '', hint: '', code: 'TIMEOUT' },
      }) as Awaited<typeof ridesListQuery>
  );
  if (error?.message === 'SUPABASE_QUERY_TIMEOUT') return [];
  if (error) throw error;
  let list = (data ?? []).filter(
    (r: { status: string; departure_time?: string }) =>
      r.status === 'published' && r.departure_time && new Date(r.departure_time) > now
  );

  const rideIds = list.map((r: { id: string }) => r.id);
  const bookedByRide: Record<string, number> = {};
  if (rideIds.length > 0) {
    const rpcCall = supabase.rpc('get_ride_booked_seats', { ride_ids: rideIds });
    const { data: seatData } = await raceWithTimeout(rpcCall, 18_000, () => ({
      data: null,
      error: null,
    }) as Awaited<typeof rpcCall>);
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
      const cap = totalSeats(r as { total_seats?: number; available_seats?: number });
      // `get_ride_booked_seats` solo devuelve filas para rides con al menos una reserva;
      // si no hay fila, los asientos reservados son 0 (no usar solo `available_seats` de la fila, puede estar en 0 por datos viejos).
      const booked = bookedByRide[r.id] ?? 0;
      const remaining = Math.max(0, cap - booked);
      return { ...r, available_seats: remaining };
    })
    .filter((r: { available_seats: number }) => r.available_seats >= seats);

  const originRadiusM =
    originNear && Number.isFinite(originNear.lat) && Number.isFinite(originNear.lng)
      ? Math.max(1, (originNear.radiusKm ?? 10) * 1000)
      : null;
  const destRadiusM =
    destinationNear && Number.isFinite(destinationNear.lat) && Number.isFinite(destinationNear.lng)
      ? Math.max(1, (destinationNear.radiusKm ?? 10) * 1000)
      : null;

  const userOriginPoint: Point | null =
    originNear && Number.isFinite(originNear.lat) && Number.isFinite(originNear.lng)
      ? { lat: originNear.lat, lng: originNear.lng }
      : null;
  const userDestPoint: Point | null =
    destinationNear && Number.isFinite(destinationNear.lat) && Number.isFinite(destinationNear.lng)
      ? { lat: destinationNear.lat, lng: destinationNear.lng }
      : null;

  if (userOriginPoint && originRadiusM != null) {
    list = list.filter((r) => {
      const d = metersUserToRidePickupRegion(r as Record<string, unknown>, userOriginPoint);
      return Number.isFinite(d) && d <= originRadiusM;
    });
  } else if (origin?.trim()) {
    list = list.filter((r: { origin_label?: string | null }) =>
      labelMatchesSearchText(r.origin_label ?? '', origin)
    );
  }

  if (userDestPoint && destRadiusM != null) {
    list = list.filter((r) => {
      const d = metersUserToRideDropoffRegion(r as Record<string, unknown>, userDestPoint);
      return Number.isFinite(d) && d <= destRadiusM;
    });
  } else if (destination?.trim()) {
    list = list.filter((r: { destination_label?: string | null }) =>
      labelMatchesSearchText(r.destination_label ?? '', destination)
    );
  }

  const max = typeof maxPrice === 'string' ? parseFloat(maxPrice) : maxPrice;
  if (typeof max === 'number' && !Number.isNaN(max) && max > 0) {
    list = list.filter((r: { price_per_seat?: number | null }) => Number(r.price_per_seat ?? 0) <= max);
  }

  const depTime = (r: { departure_time?: string }) =>
    new Date(String(r.departure_time ?? 0)).getTime();

  if (userOriginPoint || userDestPoint) {
    list.sort((a, b) => {
      const ra = (userOriginPoint ? metersUserToRidePickupRegion(a as Record<string, unknown>, userOriginPoint) : 0) +
        (userDestPoint ? metersUserToRideDropoffRegion(a as Record<string, unknown>, userDestPoint) : 0);
      const rb = (userOriginPoint ? metersUserToRidePickupRegion(b as Record<string, unknown>, userOriginPoint) : 0) +
        (userDestPoint ? metersUserToRideDropoffRegion(b as Record<string, unknown>, userDestPoint) : 0);
      if (ra !== rb) return ra - rb;
      return depTime(a as { departure_time?: string }) - depTime(b as { departure_time?: string });
    });
  } else if (origin?.trim() || destination?.trim()) {
    list.sort((a, b) => {
      let sa = 0;
      let sb = 0;
      if (origin?.trim()) {
        sa += textMatchStrength(String((a as { origin_label?: string }).origin_label ?? ''), origin);
        sb += textMatchStrength(String((b as { origin_label?: string }).origin_label ?? ''), origin);
      }
      if (destination?.trim()) {
        sa += textMatchStrength(String((a as { destination_label?: string }).destination_label ?? ''), destination);
        sb += textMatchStrength(String((b as { destination_label?: string }).destination_label ?? ''), destination);
      }
      if (sa !== sb) return sb - sa;
      return depTime(a as { departure_time?: string }) - depTime(b as { departure_time?: string });
    });
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
      description, estimated_duration_minutes, flexible_departure, started_at, vehicle_info,
      driver_lat, driver_lng, driver_location_updated_at,
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

function buildTripRequestRow(params: {
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
  pricingKind?: 'internal' | 'long_distance';
  passengerDesiredPricePerSeatGs?: number | null;
  internalQuoteAcknowledged?: boolean | null;
}): Record<string, unknown> {
  const kind = params.pricingKind === 'long_distance' ? 'long_distance' : 'internal';
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
    pricing_kind: kind,
  };
  if (params.originCity != null) row.origin_city = params.originCity;
  if (params.originDepartment != null) row.origin_department = params.originDepartment;
  if (params.originBarrio != null) row.origin_barrio = params.originBarrio;
  if (params.destinationCity != null) row.destination_city = params.destinationCity;
  if (params.destinationDepartment != null) row.destination_department = params.destinationDepartment;
  if (params.destinationBarrio != null) row.destination_barrio = params.destinationBarrio;
  if (params.routePolyline != null && params.routePolyline.length > 0) row.route_polyline = params.routePolyline;
  if (params.routeLengthKm != null) row.route_length_km = params.routeLengthKm;
  if (kind === 'long_distance' && params.passengerDesiredPricePerSeatGs != null) {
    row.passenger_desired_price_per_seat_gs = Math.round(params.passengerDesiredPricePerSeatGs);
    row.internal_quote_acknowledged = null;
  } else {
    row.passenger_desired_price_per_seat_gs = null;
    row.internal_quote_acknowledged = params.internalQuoteAcknowledged === true ? true : null;
  }
  return row;
}

/** Save trip request (passenger): when no rides match, save origin/destination/date for drivers to see. */
export async function saveTripRequest(params: {
  accessToken: string;
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
  pricingKind?: 'internal' | 'long_distance';
  passengerDesiredPricePerSeatGs?: number | null;
  internalQuoteAcknowledged?: boolean | null;
}): Promise<{ ok: boolean; error?: string }> {
  const row = buildTripRequestRow(params);
  const base = env.apiBaseUrl?.trim().replace(/\/$/, '');
  const token = params.accessToken?.trim();

  if (base && token) {
    const raw = { ...row };
    delete raw.user_id;
    const apiBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === undefined || v === null) continue;
      apiBody[k] = v;
    }
    const pk = apiBody.pricing_kind;
    const pp = apiBody.passenger_desired_price_per_seat_gs;
    if (pk === 'long_distance' && typeof pp === 'number' && Number.isFinite(pp)) {
      apiBody.passenger_desired_price_per_seat_gs = Math.round(pp);
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), SAVE_TRIP_REQUEST_API_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/trip-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(apiBody),
        signal: controller.signal,
      });
      // RN/Hermes: a veces `res.json()` puede colgarse; leer texto y parsear es más fiable.
      const text = await res.text();
      let data: { error?: string } = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as { error?: string };
        } catch {
          data = {};
        }
      }
      if (res.ok) return { ok: true };
      if (res.status === 401) {
        return { ok: false, error: 'Sesión expirada. Volvé a iniciar sesión.' };
      }
      if (res.status !== 404) {
        return { ok: false, error: data.error ?? 'No se pudo guardar la solicitud.' };
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return {
          ok: false,
          error: 'Tardó demasiado al guardar. Revisá tu conexión e intentá de nuevo.',
        };
      }
    } finally {
      clearTimeout(t);
    }
  }

  const insertBuilder = supabase.from('trip_requests').insert(row);
  const { error } = await raceWithTimeout(
    insertBuilder,
    SAVE_TRIP_REQUEST_INSERT_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: { message: 'SUPABASE_INSERT_TIMEOUT', details: '', hint: '', code: 'TIMEOUT' },
      }) as Awaited<typeof insertBuilder>
  );
  if (error?.message === 'SUPABASE_INSERT_TIMEOUT') {
    return {
      ok: false,
      error: 'Tardó demasiado al guardar. Revisá tu conexión e intentá de nuevo.',
    };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const OFFER_QUERY_TIMEOUT_MS = 20_000;

/** PostgREST cuando la tabla aún no existe en el proyecto remoto (migración no aplicada). */
function mapTripRequestDriverOffersError(message: string | undefined): string {
  const raw = String(message ?? '');
  const m = raw.toLowerCase();
  if (
    m.includes('schema cache') ||
    (m.includes('could not find') && m.includes('trip_request_driver_offers'))
  ) {
    return (
      'En tu proyecto Supabase falta la tabla de ofertas. Ejecutá el SQL de supabase/migrations/049_trip_request_driver_offers.sql ' +
      '(SQL Editor del panel o supabase db push con el repo enlazado).'
    );
  }
  return raw;
}

export type TripRequestDriverOfferRow = {
  id: string;
  driver_id: string;
  proposed_price_per_seat_gs: number;
  created_at: string;
  status: string;
};

/** Ofertas pendientes de otros conductores (y la propia) para una trip_request larga distancia. */
export async function fetchPendingTripRequestOffers(
  tripRequestId: string
): Promise<{ offers: TripRequestDriverOfferRow[]; error?: string }> {
  const q = supabase
    .from('trip_request_driver_offers')
    .select('id, driver_id, proposed_price_per_seat_gs, created_at, status')
    .eq('trip_request_id', tripRequestId)
    .eq('status', 'pending')
    .order('proposed_price_per_seat_gs', { ascending: true });
  const { data, error } = await raceWithTimeout(
    q,
    OFFER_QUERY_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: { message: 'TIMEOUT', details: '', hint: '', code: 'TIMEOUT' },
      }) as Awaited<typeof q>
  );
  if (error?.message === 'TIMEOUT') return { offers: [], error: 'Tiempo de espera al cargar ofertas.' };
  if (error) return { offers: [], error: mapTripRequestDriverOffersError(error.message) };
  return { offers: (data ?? []) as TripRequestDriverOfferRow[] };
}

export async function fetchProfileDisplayNamesByIds(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (uniq.length === 0) return {};
  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', uniq);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const r of data as { id: string; full_name: string | null }[]) {
    out[r.id] = r.full_name?.trim() ? String(r.full_name).trim() : 'Conductor';
  }
  return out;
}

export async function upsertMyTripRequestDriverOffer(params: {
  tripRequestId: string;
  driverId: string;
  pricePerSeatGs: number;
}): Promise<{ ok: boolean; error?: string }> {
  const n = Math.round(params.pricePerSeatGs);
  if (!Number.isFinite(n) || n < 1000) {
    return { ok: false, error: 'Indicá un precio válido por asiento (mín. 1.000 Gs).' };
  }
  const row = {
    trip_request_id: params.tripRequestId,
    driver_id: params.driverId,
    proposed_price_per_seat_gs: n,
    status: 'pending' as const,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('trip_request_driver_offers').upsert(row, {
    onConflict: 'trip_request_id,driver_id',
  });
  if (error) return { ok: false, error: mapTripRequestDriverOffersError(error.message) };
  return { ok: true };
}

/** My trip requests (passenger). */
export async function fetchMyTripRequests(userId: string) {
  const trQuery = supabase
    .from('trip_requests')
    .select(
      'id, origin_label, destination_label, requested_date, requested_time, seats, status, ride_id, created_at, pricing_kind, passenger_desired_price_per_seat_gs, internal_quote_acknowledged'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  const { data, error } = await raceWithTimeout(
    trQuery,
    SUPABASE_QUERY_TIMEOUT_MS,
    () =>
      ({
        data: null,
        error: { message: 'SUPABASE_QUERY_TIMEOUT', details: '', hint: '', code: 'TIMEOUT' },
      }) as Awaited<typeof trQuery>
  );
  if (error?.message === 'SUPABASE_QUERY_TIMEOUT') return [];
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
