import { distanceMeters, getPositionAlongPolyline } from '@/lib/geo';
import type { Point } from '@/types';
import { nearestRideStopIdForBookingPoint, type RideStopForBookingLink } from '@/lib/booking-stop-link';
import { isOperationalDriverStop } from '@/lib/rideStopKinds';

/** Distancia máxima para habilitar / validar “Llegué” respecto al punto visitado. */
export const ARRIVE_GATE_M = 70;

/** Pasajeros espontáneos o bajada cercana al minibús (ubicación actual del conductor). */
export const ARRIVE_NEAR_BUS_M = 100;

export type ArriveVisitKind = 'pickup' | 'dropoff' | 'published';

export type BoardingEventLite = {
  booking_id: string;
  event_type: string;
};

export type BookingGeoLite = {
  id: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

export function driverNearArriveAnchor(
  driverLat: number,
  driverLng: number,
  anchorLat: number,
  anchorLng: number,
  maxMeters: number = ARRIVE_GATE_M
): boolean {
  if (
    !Number.isFinite(driverLat) ||
    !Number.isFinite(driverLng) ||
    !Number.isFinite(anchorLat) ||
    !Number.isFinite(anchorLng)
  ) {
    return false;
  }
  return distanceMeters({ lat: driverLat, lng: driverLng }, { lat: anchorLat, lng: anchorLng }) <= maxMeters;
}

export function hasBoardingEvent(
  events: BoardingEventLite[],
  bookingId: string,
  type: 'boarded' | 'no_show' | 'dropped_off' | 'stop_visited'
): boolean {
  return events.some((e) => String(e.booking_id) === bookingId && e.event_type === type);
}

export function isBoarded(events: BoardingEventLite[], bookingId: string): boolean {
  return hasBoardingEvent(events, bookingId, 'boarded');
}

export function pickupDecisionDone(events: BoardingEventLite[], bookingId: string): boolean {
  return (
    hasBoardingEvent(events, bookingId, 'boarded') || hasBoardingEvent(events, bookingId, 'no_show')
  );
}

export function dropoffDone(events: BoardingEventLite[], bookingId: string): boolean {
  return hasBoardingEvent(events, bookingId, 'dropped_off');
}

export function stopVisitAcknowledged(events: BoardingEventLite[], bookingId: string): boolean {
  return hasBoardingEvent(events, bookingId, 'stop_visited');
}

export function pickupVisitDone(events: BoardingEventLite[], bookingId: string): boolean {
  return pickupDecisionDone(events, bookingId) || stopVisitAcknowledged(events, bookingId);
}

export function dropoffVisitDone(events: BoardingEventLite[], bookingId: string): boolean {
  return dropoffDone(events, bookingId) || stopVisitAcknowledged(events, bookingId);
}

/** Subieron y aún no tienen evento de bajada (lista del conductor en viaje en curso). */
export function boardedBookingsPendingDropoff(
  bookings: BookingGeoLite[],
  events: BoardingEventLite[]
): BookingGeoLite[] {
  return bookings.filter(
    (b) => b.status !== 'cancelled' && isBoarded(events, b.id) && !dropoffDone(events, b.id)
  );
}

export function bookingPickupPoint(b: BookingGeoLite): Point | null {
  const lat = Number(b.pickup_lat);
  const lng = Number(b.pickup_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function bookingDropoffPoint(b: BookingGeoLite): Point | null {
  const lat = Number(b.dropoff_lat);
  const lng = Number(b.dropoff_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function nearestPublishedStopOrder(
  stops: Array<RideStopForBookingLink & { stop_order: number; is_base_stop?: boolean | null }>,
  lat: number,
  lng: number
): number | null {
  const operational = stops.filter(isOperationalDriverStop);
  const id = nearestRideStopIdForBookingPoint(operational, lat, lng);
  if (!id) return null;
  const row = stops.find((s) => s.id === id);
  return row != null && Number.isFinite(row.stop_order) ? row.stop_order : null;
}

/** Reservas activas cuyo pickup coincide con la visita (fila pickup del recorrido). */
export function primaryPickupBookingsForVisit(
  bookings: BookingGeoLite[],
  events: BoardingEventLite[],
  visitBookingId: string | undefined
): BookingGeoLite[] {
  if (!visitBookingId) return [];
  const b = bookings.find((x) => x.id === visitBookingId && x.status !== 'cancelled');
  if (!b || pickupDecisionDone(events, b.id)) return [];
  return [b];
}

/** Reserva de bajada en este punto (fila dropoff del recorrido). */
export function primaryDropoffBookingsForVisit(
  bookings: BookingGeoLite[],
  events: BoardingEventLite[],
  visitBookingId: string | undefined
): BookingGeoLite[] {
  if (!visitBookingId) return [];
  const b = bookings.find((x) => x.id === visitBookingId && x.status !== 'cancelled');
  if (!b || !isBoarded(events, b.id) || dropoffDone(events, b.id)) return [];
  return [b];
}

/** Subidas pendientes cerca del minibús, excluyendo la lista principal. */
export function extraPickupBookingsNearBus(
  bookings: BookingGeoLite[],
  events: BoardingEventLite[],
  driver: Point,
  excludeIds: Set<string>
): BookingGeoLite[] {
  const out: BookingGeoLite[] = [];
  for (const b of bookings) {
    if (b.status === 'cancelled' || excludeIds.has(b.id)) continue;
    if (pickupDecisionDone(events, b.id)) continue;
    const p = bookingPickupPoint(b);
    if (!p) continue;
    if (distanceMeters(driver, p) <= ARRIVE_NEAR_BUS_M) out.push(b);
  }
  out.sort(
    (a, b) =>
      distanceMeters(driver, bookingPickupPoint(a)!) - distanceMeters(driver, bookingPickupPoint(b)!)
  );
  return out;
}

/** A bordo: pueden bajar cerca del bus o en el punto de bajada del recorrido; orden por avance en ruta. */
export function dropoffBookingsForArriveModal(
  bookings: BookingGeoLite[],
  events: BoardingEventLite[],
  driver: Point,
  routePoints: Point[],
  visitKind: ArriveVisitKind,
  visitBookingId: string | undefined,
  anchor: Point
): BookingGeoLite[] {
  const primaryIds = new Set<string>();
  if (visitKind === 'dropoff' && visitBookingId) primaryIds.add(visitBookingId);

  const candidates: BookingGeoLite[] = [];
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    if (!isBoarded(events, b.id) || dropoffDone(events, b.id)) continue;
    const drop = bookingDropoffPoint(b);
    if (!drop) continue;
    const atVisit = visitKind === 'dropoff' && b.id === visitBookingId;
    const nearBus = distanceMeters(driver, drop) <= ARRIVE_NEAR_BUS_M;
    const nearAnchor = distanceMeters(anchor, drop) <= ARRIVE_GATE_M;
    if (atVisit || nearBus || nearAnchor) candidates.push(b);
  }

  const base = routePoints.length >= 2 ? routePoints : [];
  candidates.sort((a, b) => {
    const pa = bookingDropoffPoint(a)!;
    const pb = bookingDropoffPoint(b)!;
    if (base.length >= 2) {
      const ta = getPositionAlongPolyline(pa, base);
      const tb = getPositionAlongPolyline(pb, base);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    }
    return distanceMeters(driver, pa) - distanceMeters(driver, pb);
  });

  return candidates.filter((b) => !primaryIds.has(b.id));
}

export function canRegisterPassengerAction(
  bookings: BookingGeoLite[],
  events: BoardingEventLite[],
  driver: Point,
  passenger: { id: string; action: 'boarded' | 'no_show' | 'dropped_off' },
  primaryPickupIds: Set<string>,
  primaryDropoffIds: Set<string>,
  visitKind: ArriveVisitKind,
  visitBookingId: string | undefined,
  anchor: Point,
  routePoints: Point[]
): boolean {
  const b = bookings.find((x) => x.id === passenger.id);
  if (!b || b.status === 'cancelled') return false;

  if (passenger.action === 'boarded' || passenger.action === 'no_show') {
    if (pickupDecisionDone(events, b.id)) return false;
    if (primaryPickupIds.has(b.id)) return true;
    // Confirmación explícita del conductor en el modal (misma regla que bajada manual).
    return true;
  }

  if (passenger.action === 'dropped_off') {
    if (!isBoarded(events, b.id) || dropoffDone(events, b.id)) return false;
    if (primaryDropoffIds.has(b.id)) return true;
    // Misma regla que POST /dropoff-passenger: el conductor puede registrar la bajada sin estar en el pin.
    return true;
  }

  return false;
}
