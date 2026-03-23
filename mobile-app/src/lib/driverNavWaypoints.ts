/**
 * Puntos de subida/bajada de reservas que van **antes** del destino de navegación del conductor
 * sobre la polyline base (misma referencia que el mapa / OSRM merge).
 */
import { distanceMeters, getPositionAlongPolyline, type Point } from './geo';

const DEDUP_M = 12;
const NEAR_DEST_M = 40;
const T_EPS = 1e-5;

export function passengerWaypointsBeforeDestination(
  baseRoute: Point[],
  bookingPins: Array<{ pickup: Point; dropoff: Point }>,
  destination: Point
): Point[] {
  if (baseRoute.length < 2 || bookingPins.length === 0) return [];
  const tDest = getPositionAlongPolyline(destination, baseRoute);
  const tagged: { p: Point; t: number; ord: number }[] = [];
  let ord = 0;
  for (const b of bookingPins) {
    tagged.push({ p: b.pickup, t: getPositionAlongPolyline(b.pickup, baseRoute), ord: ord++ });
    tagged.push({ p: b.dropoff, t: getPositionAlongPolyline(b.dropoff, baseRoute), ord: ord++ });
  }
  const filtered = tagged.filter((x) => x.t < tDest - T_EPS);
  filtered.sort((a, b) => a.t - b.t || a.ord - b.ord);

  const out: Point[] = [];
  for (const { p } of filtered) {
    if (distanceMeters(p, destination) < NEAR_DEST_M) continue;
    if (out.length && distanceMeters(out[out.length - 1], p) < DEDUP_M) continue;
    out.push(p);
  }
  return out;
}
