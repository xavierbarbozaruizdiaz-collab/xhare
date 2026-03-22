/**
 * Geo helpers for proximity search (port from web @/lib/geo).
 */

export type Point = { lat: number; lng: number };

export function distanceMeters(p1: Point, p2: Point): number {
  const R = 6371000;
  const dLat = toRadians(p2.lat - p1.lat);
  const dLon = toRadians(p2.lng - p1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(p1.lat)) * Math.cos(toRadians(p2.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function distanceToSegment(point: Point, segmentStart: Point, segmentEnd: Point): number {
  const A = point.lat - segmentStart.lat;
  const B = point.lng - segmentStart.lng;
  const C = segmentEnd.lat - segmentStart.lat;
  const D = segmentEnd.lng - segmentStart.lng;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq !== 0 ? dot / lenSq : -1;
  param = Math.max(0, Math.min(1, param));
  const xx = segmentStart.lat + param * C;
  const yy = segmentStart.lng + param * D;
  const dx = point.lat - xx;
  const dy = point.lng - yy;
  return Math.sqrt(dx * dx + dy * dy) * 111000;
}

export function distancePointToPolylineMeters(point: Point, polyline: Point[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distanceMeters(point, polyline[0]);
  let minDistance = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = distanceToSegment(point, polyline[i], polyline[i + 1]);
    minDistance = Math.min(minDistance, dist);
  }
  return minDistance;
}

function closestPointOnSegment(point: Point, segmentStart: Point, segmentEnd: Point): Point {
  const A = point.lat - segmentStart.lat;
  const B = point.lng - segmentStart.lng;
  const C = segmentEnd.lat - segmentStart.lat;
  const D = segmentEnd.lng - segmentStart.lng;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq !== 0 ? dot / lenSq : -1;
  param = Math.max(0, Math.min(1, param));
  return { lat: segmentStart.lat + param * C, lng: segmentStart.lng + param * D };
}

function closestPointOnPolyline(point: Point, polyline: Point[]): { point: Point; segmentIndex: number } {
  if (polyline.length <= 1) return { point: polyline[0] ?? point, segmentIndex: 0 };
  let minDistance = Infinity;
  let closestPoint: Point = polyline[0];
  let segmentIndex = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const closest = closestPointOnSegment(point, polyline[i], polyline[i + 1]);
    const dist = distanceMeters(point, closest);
    if (dist < minDistance) {
      minDistance = dist;
      closestPoint = closest;
      segmentIndex = i;
    }
  }
  return { point: closestPoint, segmentIndex };
}

export function getPositionAlongPolyline(point: Point, polyline: Point[]): number {
  if (!polyline || polyline.length < 2) return 0;
  const n = polyline.length;
  const cumulative: number[] = [0];
  for (let i = 1; i < n; i++) {
    cumulative[i] = cumulative[i - 1] + distanceMeters(polyline[i - 1], polyline[i]);
  }
  const totalLength = cumulative[n - 1];
  if (totalLength === 0) return 0;
  const { segmentIndex } = closestPointOnPolyline(point, polyline);
  const segStart = polyline[segmentIndex];
  const segEnd = polyline[segmentIndex + 1];
  const segLen = distanceMeters(segStart, segEnd);
  const closest = closestPointOnSegment(point, segStart, segEnd);
  const param = segLen > 0 ? distanceMeters(segStart, closest) / segLen : 0;
  const position = cumulative[segmentIndex] + param * segLen;
  return Math.max(0, Math.min(1, position / totalLength));
}

const PROXIMITY_METERS = 2000;

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
    return poly.map((p: any) => ({ lat: p.lat ?? p[1], lng: p.lng ?? p[0] }));
  }
  const stops = ride.ride_stops;
  if (Array.isArray(stops) && stops.length >= 2) {
    const sorted = [...stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    return sorted.map((s) => ({ lat: s.lat, lng: s.lng }));
  }
  const o =
    ride.origin_lat != null && ride.origin_lng != null ? { lat: ride.origin_lat, lng: ride.origin_lng } : null;
  const d =
    ride.destination_lat != null && ride.destination_lng != null
      ? { lat: ride.destination_lat, lng: ride.destination_lng }
      : null;
  if (o && d) return [o, d];
  return [];
}

export function rideProximityCheck(
  ride: Parameters<typeof buildPolylineFromRide>[0],
  origin: Point,
  destination: Point,
  maxMeters: number = PROXIMITY_METERS
): { match: boolean; distanceOriginMeters: number; distanceDestMeters: number } {
  const polyline = buildPolylineFromRide(ride);
  if (polyline.length < 2) {
    return { match: false, distanceOriginMeters: Infinity, distanceDestMeters: Infinity };
  }
  const distanceOriginMeters = distancePointToPolylineMeters(origin, polyline);
  const distanceDestMeters = distancePointToPolylineMeters(destination, polyline);
  const originPosition = getPositionAlongPolyline(origin, polyline);
  const destPosition = getPositionAlongPolyline(destination, polyline);
  const withinDistance = distanceOriginMeters <= maxMeters && distanceDestMeters <= maxMeters;
  const correctOrder = originPosition < destPosition;
  const match = withinDistance && correctOrder;
  return { match, distanceOriginMeters, distanceDestMeters };
}

export { PROXIMITY_METERS };
