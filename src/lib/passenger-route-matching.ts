import {
  distancePointToPolylineMeters,
  getPositionAlongPolyline,
} from '@/lib/geo';
import type { Point } from '@/types';

export type RouteMatchRide = {
  id: string;
  status?: string | null;
  departure_time?: string | null;
  estimated_duration_minutes?: number | null;
  max_deviation_km?: number | null;
  passenger_match_radius_m?: number | null;
  total_seats?: number | null;
  base_route_polyline?: unknown;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  driver_location_updated_at?: string | null;
};

export type RouteMatchBooking = {
  id: string;
  passenger_id?: string | null;
  status?: string | null;
  seats_count?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  pickup_route_position?: number | null;
  dropoff_route_position?: number | null;
};

export type RouteMatchBoardingEvent = {
  booking_id: string;
  event_type: string;
};

export type PassengerRouteMatch = {
  originDistanceMeters: number;
  destinationDistanceMeters: number;
  pickupPosition: number;
  dropoffPosition: number;
  driverPosition: number | null;
  maxDeviationMeters: number;
  estimatedPickupIso: string | null;
  estimatedDropoffIso: string | null;
};

function pointFromStoredEntry(raw: unknown): Point | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const row = raw as { lat?: unknown; lng?: unknown };
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  return null;
}

export function parseRidePolyline(ride: RouteMatchRide): Point[] {
  if (Array.isArray(ride.base_route_polyline)) {
    const points = ride.base_route_polyline
      .map(pointFromStoredEntry)
      .filter((point): point is Point => point != null);
    if (points.length >= 2) return points;
  }
  const origin =
    ride.origin_lat != null && ride.origin_lng != null
      ? { lat: Number(ride.origin_lat), lng: Number(ride.origin_lng) }
      : null;
  const destination =
    ride.destination_lat != null && ride.destination_lng != null
      ? { lat: Number(ride.destination_lat), lng: Number(ride.destination_lng) }
      : null;
  return origin &&
    destination &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    Number.isFinite(destination.lat) &&
    Number.isFinite(destination.lng)
    ? [origin, destination]
    : [];
}

function rideEtaIso(
  ride: RouteMatchRide,
  routePosition: number,
  driverPosition: number | null,
  now: Date
): string | null {
  const durationRaw = Number(ride.estimated_duration_minutes ?? 60);
  const durationMinutes = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 60;
  if (ride.status === 'en_route' && driverPosition != null) {
    const remainingFraction = Math.max(0, routePosition - driverPosition);
    return new Date(now.getTime() + remainingFraction * durationMinutes * 60_000).toISOString();
  }
  const departureMs = new Date(String(ride.departure_time ?? '')).getTime();
  return Number.isFinite(departureMs)
    ? new Date(departureMs + routePosition * durationMinutes * 60_000).toISOString()
    : null;
}

export function matchPassengerRoute(
  ride: RouteMatchRide,
  origin: Point,
  destination: Point,
  now: Date = new Date(),
  purpose: 'search' | 'book' = 'book'
): PassengerRouteMatch | null {
  const polyline = parseRidePolyline(ride);
  if (polyline.length < 2) return null;

  const originDistanceMeters = distancePointToPolylineMeters(origin, polyline);
  const destinationDistanceMeters = distancePointToPolylineMeters(destination, polyline);
  const deviationKm = Number(ride.max_deviation_km ?? 1);
  const bookingDeviationMeters =
    Math.max(0.2, Number.isFinite(deviationKm) && deviationKm > 0 ? deviationKm : 1) * 1000;
  const configuredMatchRadius = Number(ride.passenger_match_radius_m);
  const searchRadiusMeters =
    Number.isFinite(configuredMatchRadius) && configuredMatchRadius > 0
      ? Math.max(200, configuredMatchRadius)
      : bookingDeviationMeters;
  const maxDeviationMeters = purpose === 'search' ? Math.min(searchRadiusMeters, bookingDeviationMeters) : bookingDeviationMeters;
  const pickupPosition = getPositionAlongPolyline(origin, polyline);
  const dropoffPosition = getPositionAlongPolyline(destination, polyline);

  if (
    originDistanceMeters > maxDeviationMeters ||
    destinationDistanceMeters > maxDeviationMeters ||
    dropoffPosition <= pickupPosition + 1e-5
  ) {
    return null;
  }

  let driverPosition: number | null = null;
  if (ride.status === 'en_route') {
    const lat = Number(ride.driver_lat);
    const lng = Number(ride.driver_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const locationUpdatedMs = new Date(String(ride.driver_location_updated_at ?? '')).getTime();
    if (!Number.isFinite(locationUpdatedMs) || now.getTime() - locationUpdatedMs > 10 * 60_000) {
      return null;
    }
    driverPosition = getPositionAlongPolyline({ lat, lng }, polyline);
    // Evita ofrecer una recogida que el móvil ya pasó; 0,2 % tolera ruido de GPS/proyección.
    if (pickupPosition <= driverPosition + 0.002) return null;
  }

  return {
    originDistanceMeters,
    destinationDistanceMeters,
    pickupPosition,
    dropoffPosition,
    driverPosition,
    maxDeviationMeters,
    estimatedPickupIso: rideEtaIso(ride, pickupPosition, driverPosition, now),
    estimatedDropoffIso: rideEtaIso(ride, dropoffPosition, driverPosition, now),
  };
}

function bookingInterval(
  booking: RouteMatchBooking,
  polyline: Point[]
): { start: number; end: number; seats: number } | null {
  let start = Number(booking.pickup_route_position);
  let end = Number(booking.dropoff_route_position);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    const pickup =
      booking.pickup_lat != null && booking.pickup_lng != null
        ? { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) }
        : null;
    const dropoff =
      booking.dropoff_lat != null && booking.dropoff_lng != null
        ? { lat: Number(booking.dropoff_lat), lng: Number(booking.dropoff_lng) }
        : null;
    if (
      pickup &&
      dropoff &&
      Number.isFinite(pickup.lat) &&
      Number.isFinite(pickup.lng) &&
      Number.isFinite(dropoff.lat) &&
      Number.isFinite(dropoff.lng)
    ) {
      start = getPositionAlongPolyline(pickup, polyline);
      end = getPositionAlongPolyline(dropoff, polyline);
    } else {
      // Reservas antiguas sin puntos ocupan conservadoramente todo el recorrido.
      start = 0;
      end = 1;
    }
  }
  if (end <= start) return null;
  return {
    start: Math.max(0, Math.min(1, start)),
    end: Math.max(0, Math.min(1, end)),
    seats: Math.max(0, Math.round(Number(booking.seats_count ?? 0))),
  };
}

export function deriveBookingRoutePositions(
  ride: RouteMatchRide,
  booking: RouteMatchBooking
): { pickupPosition: number; dropoffPosition: number } | null {
  const interval = bookingInterval(booking, parseRidePolyline(ride));
  return interval
    ? { pickupPosition: interval.start, dropoffPosition: interval.end }
    : null;
}

export function segmentAvailableSeats(
  ride: RouteMatchRide,
  match: Pick<PassengerRouteMatch, 'pickupPosition' | 'dropoffPosition'>,
  bookings: RouteMatchBooking[],
  events: RouteMatchBoardingEvent[]
): number {
  const totalSeats = Math.max(0, Math.round(Number(ride.total_seats ?? 0)));
  if (totalSeats < 1) return 0;
  const polyline = parseRidePolyline(ride);
  if (polyline.length < 2) return 0;
  const inactiveBookingIds = new Set(
    events
      .filter((event) => event.event_type === 'no_show' || event.event_type === 'dropped_off')
      .map((event) => String(event.booking_id))
  );
  const intervals = bookings
    .filter(
      (booking) =>
        booking.status !== 'cancelled' &&
        !inactiveBookingIds.has(String(booking.id))
    )
    .map((booking) => bookingInterval(booking, polyline))
    .filter((interval): interval is { start: number; end: number; seats: number } => interval != null)
    .filter(
      (interval) =>
        interval.end > match.pickupPosition && interval.start < match.dropoffPosition
    );

  const boundaries = new Set<number>([match.pickupPosition]);
  for (const interval of intervals) {
    if (interval.start > match.pickupPosition && interval.start < match.dropoffPosition) {
      boundaries.add(interval.start);
    }
  }

  let maxOccupied = 0;
  for (const position of Array.from(boundaries)) {
    const occupied = intervals.reduce(
      (sum, interval) =>
        interval.start <= position + 1e-8 && interval.end > position + 1e-8
          ? sum + interval.seats
          : sum,
      0
    );
    maxOccupied = Math.max(maxOccupied, occupied);
  }
  return Math.max(0, totalSeats - maxOccupied);
}
