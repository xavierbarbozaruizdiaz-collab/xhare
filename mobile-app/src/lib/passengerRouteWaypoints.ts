/**
 * Waypoints OSRM entre subida y bajada del pasajero: paradas extra del pasajero + paradas intermedias
 * del conductor que caen en ese tramo de la ruta publicada (ordenadas por progreso en la polyline).
 */
import {
  distanceMeters,
  distancePointToPolylineMeters,
  getPositionAlongPolyline,
  slicePolylineBetweenT,
  type Point,
} from './geo';

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

/** No duplicar waypoints con la subida/bajada del usuario que está reservando. */
const AVOID_OVERLAP_AB_M = 45;

/**
 * Subidas/bajadas de otros pasajeros en el tramo A–B.
 * Incluye puntos con progreso `t` estrictamente entre A y B, y también los que están
 * **desplazados de la línea** (calle lateral, acceso) si quedan cerca del subtramo publicado entre A y B:
 * sin eso OSRM solo seguiría la avenida y “flotarían” los pins grises.
 */
export function otherPassengerWaypointsBetween(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  otherPoints: Point[],
  /** Máx. distancia (m) del punto al tramo base entre A y B para considerarlo en el mismo corredor. */
  maxDetourMeters: number = 2000
): Point[] {
  if (baseRoute.length < 2 || otherPoints.length === 0) return [];
  const tPu = getPositionAlongPolyline(pickup, baseRoute);
  const tDo = getPositionAlongPolyline(dropoff, baseRoute);
  const lo = Math.min(tPu, tDo);
  const hi = Math.max(tPu, tDo);
  const segmentPoly = slicePolylineBetweenT(baseRoute, lo, hi);
  const segForProximity = segmentPoly.length >= 2 ? segmentPoly : baseRoute;

  const tagged = otherPoints
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .filter(
      (p) =>
        distanceMeters(p, pickup) >= AVOID_OVERLAP_AB_M && distanceMeters(p, dropoff) >= AVOID_OVERLAP_AB_M
    )
    .map((p, i) => {
      const pos = getPositionAlongPolyline(p, baseRoute);
      const strictInterior = pos > lo + 1e-6 && pos < hi - 1e-6;
      const distToSegment = distancePointToPolylineMeters(p, segForProximity);
      const nearAbCorridor = distToSegment <= maxDetourMeters;
      const ok = strictInterior || nearAbCorridor;
      return { p, pos, ord: i, ok };
    })
    .filter((x) => x.ok);
  tagged.sort((a, b) => a.pos - b.pos || a.ord - b.ord);
  const out: Point[] = [];
  for (const { p } of tagged) {
    if (out.length === 0 || distanceMeters(out[out.length - 1], p) >= DEDUP_M) out.push(p);
  }
  return out;
}

/** Une extras del pasajero, paradas del conductor y puntos de otros pasajeros en el tramo (A,B), por t en la base. */
export function mergeOsrmWaypointsBetween(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  extras: Point[],
  driverBetween: Point[],
  otherPassengersBetween: Point[] = []
): Point[] {
  if (baseRoute.length < 2) return [];
  const tPu = getPositionAlongPolyline(pickup, baseRoute);
  const tDo = getPositionAlongPolyline(dropoff, baseRoute);
  const lo = Math.min(tPu, tDo);
  const hi = Math.max(tPu, tDo);
  const inOpenInterval = (pos: number) => pos > lo + 1e-6 && pos < hi - 1e-6;
  const tagged = [
    ...extras
      .map((p, i) => ({ p, pos: getPositionAlongPolyline(p, baseRoute), ord: i }))
      .filter((x) => inOpenInterval(x.pos)),
    ...driverBetween
      .map((p, i) => ({ p, pos: getPositionAlongPolyline(p, baseRoute), ord: i + 1e6 }))
      .filter((x) => inOpenInterval(x.pos)),
    /** Ya filtrados por tramo A–B (incl. cercanía al subtramo para pins fuera de la línea). No repetir corte estricto por `t`. */
    ...otherPassengersBetween.map((p, i) => ({
      p,
      pos: getPositionAlongPolyline(p, baseRoute),
      ord: i + 2e6,
    })),
  ];
  tagged.sort((a, b) => a.pos - b.pos || a.ord - b.ord);
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
