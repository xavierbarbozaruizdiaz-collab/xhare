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

/** Proyecta un punto sobre la polyline (útil para marcar subida/bajada/paradas sobre el corredor OSRM). */
export function snapToPolyline(point: Point, polyline: Point[]): Point {
  if (!polyline || polyline.length === 0) return point;
  if (polyline.length === 1) return { lat: polyline[0].lat, lng: polyline[0].lng };
  let minDistance = Infinity;
  let closestPoint: Point = polyline[0];
  for (let i = 0; i < polyline.length - 1; i++) {
    const closest = closestPointOnSegment(point, polyline[i], polyline[i + 1]);
    const dist = distanceMeters(point, closest);
    if (dist < minDistance) {
      minDistance = dist;
      closestPoint = closest;
    }
  }
  return closestPoint;
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

function polylineCumulative(polyline: Point[]): { cum: number[]; total: number } {
  const n = polyline.length;
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + distanceMeters(polyline[i - 1], polyline[i]);
  return { cum, total: cum[n - 1] ?? 0 };
}

/** Punto sobre la polyline a `dist` metros desde el inicio (0 … total). */
function pointAtDistanceAlongPolyline(polyline: Point[], dist: number): Point {
  const n = polyline.length;
  if (n < 1) return { lat: 0, lng: 0 };
  if (n === 1) return { ...polyline[0] };
  const { cum, total } = polylineCumulative(polyline);
  if (total <= 0) return { ...polyline[0] };
  const d = Math.max(0, Math.min(total, dist));
  let idx = 0;
  while (idx < n - 1 && cum[idx + 1] < d) idx++;
  const seg0 = polyline[idx];
  const seg1 = polyline[idx + 1];
  const len = distanceMeters(seg0, seg1);
  const along = d - cum[idx];
  const u = len > 0 ? Math.max(0, Math.min(1, along / len)) : 0;
  return {
    lat: seg0.lat + u * (seg1.lat - seg0.lat),
    lng: seg0.lng + u * (seg1.lng - seg0.lng),
  };
}

/**
 * Sub-polyline de la geometría base entre dos posiciones normalizadas (0–1) a lo largo del recorrido.
 * No es un OSRM nuevo: solo recorta la ruta publicada.
 */
export function slicePolylineBetweenT(polyline: Point[], t0: number, t1: number): Point[] {
  const n = polyline.length;
  if (n < 2) return [];
  const { cum, total } = polylineCumulative(polyline);
  if (total <= 0) return [];

  const lo = Math.max(0, Math.min(1, Math.min(t0, t1)));
  const hi = Math.max(0, Math.min(1, Math.max(t0, t1)));
  const d0 = lo * total;
  const d1 = hi * total;
  if (d1 - d0 < 0.5) return [];

  const start = pointAtDistanceAlongPolyline(polyline, d0);
  const end = pointAtDistanceAlongPolyline(polyline, d1);
  const out: Point[] = [start];
  for (let i = 1; i < n - 1; i++) {
    if (cum[i] > d0 && cum[i] < d1) out.push({ ...polyline[i] });
  }
  if (distanceMeters(out[out.length - 1], end) > 2) out.push(end);
  else out[out.length - 1] = end;
  return out.length >= 2 ? out : [];
}

/**
 * Tramo del pasajero (A → paradas → B) **sobre la misma polyline del conductor** (recorte + proyección al corredor).
 */
export function passengerSegmentAlongBaseRoute(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  extraPoints: Point[] = []
): Point[] {
  if (baseRoute.length < 2) return [];
  let t0 = getPositionAlongPolyline(pickup, baseRoute);
  let t1 = getPositionAlongPolyline(dropoff, baseRoute);
  if (t0 > t1) {
    const tmp = t0;
    t0 = t1;
    t1 = tmp;
  }

  const innerT = extraPoints
    .map((p) => getPositionAlongPolyline(p, baseRoute))
    .filter((t) => t > t0 + 1e-8 && t < t1 - 1e-8)
    .sort((a, b) => a - b);

  const breaks = [t0, ...innerT, t1];
  const out: Point[] = [];
  for (let b = 0; b < breaks.length - 1; b++) {
    const chunk = slicePolylineBetweenT(baseRoute, breaks[b], breaks[b + 1]);
    if (chunk.length < 2) continue;
    if (out.length === 0) out.push(...chunk);
    else out.push(...chunk.slice(1));
  }
  return out.length >= 2 ? out : [];
}

const PROXIMITY_METERS = 2000;

/** Igual criterio que `parseBaseRoutePolyline` en Next: evita NaN en el mapa / OSRM (Android no dibuja la línea). */
function pointFromStoredPolyEntry(p: unknown): Point | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const o = p as { lat?: unknown; lng?: unknown };
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (Array.isArray(p) && p.length >= 2) {
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

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
    const pts = poly.map(pointFromStoredPolyEntry).filter((x): x is Point => x != null);
    if (pts.length >= 2) return pts;
  }
  const stops = ride.ride_stops;
  if (Array.isArray(stops) && stops.length >= 2) {
    const sorted = [...stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    return sorted
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => ({ lat: s.lat, lng: s.lng }));
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
