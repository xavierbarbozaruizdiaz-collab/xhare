/**
 * Waypoints OSRM entre subida y bajada del pasajero: paradas extra del pasajero + paradas intermedias
 * del conductor que caen en ese tramo de la ruta publicada (ordenadas por progreso en la polyline).
 */
import { distanceMeters, getPositionAlongPolyline, type Point } from './geo';

export type DriverStopForWaypoint = { lat: number; lng: number; stop_order?: number };

/** Paradas del conductor que no son origen ni destino del viaje, entre pickup y dropoff sobre la base. */
export function driverIntermediateStopsBetween(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  driverStops: DriverStopForWaypoint[]
): Point[] {
  if (baseRoute.length < 2) return [];
  const sorted = [...driverStops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
  if (sorted.length < 3) return [];
  const intermediates = sorted.slice(1, -1);
  const tPu = getPositionAlongPolyline(pickup, baseRoute);
  const tDo = getPositionAlongPolyline(dropoff, baseRoute);
  const lo = Math.min(tPu, tDo);
  const hi = Math.max(tPu, tDo);
  return intermediates
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => {
      const p = { lat: s.lat, lng: s.lng };
      return { p, pos: getPositionAlongPolyline(p, baseRoute) };
    })
    .filter((x) => x.pos > lo + 1e-6 && x.pos < hi - 1e-6)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.p);
}

const DEDUP_M = 12;

/** Une extras del pasajero y paradas del conductor en el tramo (A,B), ordenadas por t en la base. */
export function mergeOsrmWaypointsBetween(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  extras: Point[],
  driverBetween: Point[]
): Point[] {
  if (baseRoute.length < 2) return [];
  const tPu = getPositionAlongPolyline(pickup, baseRoute);
  const tDo = getPositionAlongPolyline(dropoff, baseRoute);
  const lo = Math.min(tPu, tDo);
  const hi = Math.max(tPu, tDo);
  const tagged = [
    ...extras.map((p) => ({ p, pos: getPositionAlongPolyline(p, baseRoute) })),
    ...driverBetween.map((p) => ({ p, pos: getPositionAlongPolyline(p, baseRoute) })),
  ].filter((x) => x.pos > lo + 1e-6 && x.pos < hi - 1e-6);
  tagged.sort((a, b) => a.pos - b.pos);
  const out: Point[] = [];
  for (const { p } of tagged) {
    if (out.length === 0 || distanceMeters(out[out.length - 1], p) >= DEDUP_M) out.push(p);
  }
  return out;
}

/** Paradas intermedias del conductor entre dos progresos t en la polyline base (origen/destino del viaje excluidos). */
export function driverIntermediateStopsBetweenT(
  baseRoute: Point[],
  tLo: number,
  tHi: number,
  driverStops: DriverStopForWaypoint[]
): Point[] {
  if (baseRoute.length < 2) return [];
  const lo = Math.min(tLo, tHi);
  const hi = Math.max(tLo, tHi);
  const sorted = [...driverStops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
  if (sorted.length < 3) return [];
  const intermediates = sorted.slice(1, -1);
  return intermediates
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => {
      const p = { lat: s.lat, lng: s.lng };
      return { p, pos: getPositionAlongPolyline(p, baseRoute) };
    })
    .filter((x) => x.pos > lo + 1e-6 && x.pos < hi - 1e-6)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.p);
}
