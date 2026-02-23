import {
  distancePointToPolylineMeters,
  getPositionAlongPolyline,
} from '@/lib/geo';

export type Point = { lat: number; lng: number };

const PROXIMITY_METERS = 2000; // 2 km

/**
 * Construye la polyline de un viaje a partir de base_route_polyline o origen/destino + paradas.
 */
export function buildPolylineFromRide(ride: {
  base_route_polyline?: Array<{ lat?: number; lng?: number } | [number, number]> | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  ride_stops?: Array<{ lat: number; lng: number; stop_order?: number }> | null;
}): Point[] {
  const poly = ride.base_route_polyline;
  if (Array.isArray(poly) && poly.length >= 2) {
    return poly.map((p: any) => ({
      lat: p.lat ?? p[1],
      lng: p.lng ?? p[0],
    }));
  }
  const stops = ride.ride_stops;
  if (Array.isArray(stops) && stops.length >= 2) {
    const sorted = [...stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    return sorted.map((s) => ({ lat: s.lat, lng: s.lng }));
  }
  const o =
    ride.origin_lat != null && ride.origin_lng != null
      ? { lat: ride.origin_lat, lng: ride.origin_lng }
      : null;
  const d =
    ride.destination_lat != null && ride.destination_lng != null
      ? { lat: ride.destination_lat, lng: ride.destination_lng }
      : null;
  if (o && d) return [o, d];
  return [];
}

export interface ProximityResult {
  match: boolean;
  distanceOriginMeters: number;
  distanceDestMeters: number;
  originPosition: number;
  destPosition: number;
}

/**
 * Indica si el trayecto del usuario (origen → destino) es compatible con la ruta del viaje:
 * origen y destino a ≤ maxMeters de la ruta, y origen antes que destino en el recorrido.
 */
export function rideProximityCheck(
  ride: Parameters<typeof buildPolylineFromRide>[0],
  origin: Point,
  destination: Point,
  maxMeters: number = PROXIMITY_METERS
): ProximityResult {
  const polyline = buildPolylineFromRide(ride);
  if (polyline.length < 2) {
    return {
      match: false,
      distanceOriginMeters: Infinity,
      distanceDestMeters: Infinity,
      originPosition: 0,
      destPosition: 1,
    };
  }
  const distanceOriginMeters = distancePointToPolylineMeters(origin, polyline);
  const distanceDestMeters = distancePointToPolylineMeters(destination, polyline);
  const originPosition = getPositionAlongPolyline(origin, polyline);
  const destPosition = getPositionAlongPolyline(destination, polyline);
  const withinDistance =
    distanceOriginMeters <= maxMeters && distanceDestMeters <= maxMeters;
  const correctOrder = originPosition < destPosition;
  const match = withinDistance && correctOrder;

  return {
    match,
    distanceOriginMeters,
    distanceDestMeters,
    originPosition,
    destPosition,
  };
}

export { PROXIMITY_METERS };
