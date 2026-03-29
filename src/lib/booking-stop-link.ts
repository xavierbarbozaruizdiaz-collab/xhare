import { distanceMeters } from '@/lib/geo';
import type { Point } from '@/types';

/** Misma tolerancia que el móvil al asociar subida/bajada sin validación de stop_id en BD. */
export const BOOKING_STOP_LINK_MAX_M = 1800;

/** Radio para exigir que el conductor esté cerca de la parada al confirmar “Llegué”. */
export const ARRIVE_DRIVER_MAX_DISTANCE_M = 520;

export type RideStopForBookingLink = { id: string; lat: number; lng: number };

export function nearestRideStopIdForBookingPoint(
  stops: RideStopForBookingLink[],
  lat: number | null | undefined,
  lng: number | null | undefined,
  maxMeters: number = BOOKING_STOP_LINK_MAX_M
): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (stops.length === 0) return null;
  const p: Point = { lat, lng };
  let best: { id: string; d: number } | null = null;
  for (const s of stops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const d = distanceMeters(p, { lat: s.lat, lng: s.lng });
    if (d <= maxMeters && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best?.id ?? null;
}

export function driverNearStopForArrive(
  driverLat: number,
  driverLng: number,
  stopLat: number,
  stopLng: number,
  maxMeters: number = ARRIVE_DRIVER_MAX_DISTANCE_M
): boolean {
  if (
    !Number.isFinite(driverLat) ||
    !Number.isFinite(driverLng) ||
    !Number.isFinite(stopLat) ||
    !Number.isFinite(stopLng)
  ) {
    return false;
  }
  return distanceMeters({ lat: driverLat, lng: driverLng }, { lat: stopLat, lng: stopLng }) <= maxMeters;
}

export function bookingPickupAtPublishedStop(
  b: {
    pickup_stop_id: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
  },
  publishedStopId: string,
  allStops: RideStopForBookingLink[]
): boolean {
  if (b.pickup_stop_id === publishedStopId) return true;
  if (b.pickup_stop_id != null) return false;
  return nearestRideStopIdForBookingPoint(allStops, b.pickup_lat, b.pickup_lng) === publishedStopId;
}

export function bookingDropoffAtPublishedStop(
  b: {
    dropoff_stop_id: string | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
  },
  publishedStopId: string,
  allStops: RideStopForBookingLink[]
): boolean {
  if (b.dropoff_stop_id === publishedStopId) return true;
  if (b.dropoff_stop_id != null) return false;
  return nearestRideStopIdForBookingPoint(allStops, b.dropoff_lat, b.dropoff_lng) === publishedStopId;
}
