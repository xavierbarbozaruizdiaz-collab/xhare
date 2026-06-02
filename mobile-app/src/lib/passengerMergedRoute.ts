/**
 * Recorte sobre la polyline gris (ruta publicada + reservas) + tramo por calles del pasajero actual (verde).
 * `waypointsBetween`: extras del pasajero y ajustes de ruta del conductor entre A y B.
 */
import { fetchRoute, type RouteFetchOptions } from '../backend/routeApi';
import {
  distanceMeters,
  getPositionAlongPolyline,
  slicePolylineBetweenT,
  type Point,
} from './geo';
import { driverIntermediateStopsBetweenT } from './passengerRouteWaypoints';

export type PassengerMergedSegments = { head: Point[]; mid: Point[]; tail: Point[] };

const BRIDGE_ROUTE_MIN_M = 45;

export function concatPassengerMergedParts(seg: PassengerMergedSegments, tolM = 14): Point[] {
  return concatPolylines([seg.head, seg.mid, seg.tail], tolM);
}

function concatPolylines(parts: Point[][], tolM = 14): Point[] {
  const out: Point[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const p = part[i];
      if (out.length === 0) {
        out.push({ ...p });
        continue;
      }
      const last = out[out.length - 1];
      if (i === 0 && distanceMeters(last, p) < tolM) continue;
      out.push({ ...p });
    }
  }
  return out;
}

/** Polyline por calles vía `/api/route/polyline` (Google Routes en servidor). */
async function fetchDrivingPolylineOrNull(
  origin: Point,
  destination: Point,
  waypoints: Point[] = [],
  routeOpts?: RouteFetchOptions
): Promise<Point[] | null> {
  const r = await fetchRoute(origin, destination, waypoints, routeOpts);
  if (r.aborted) return null;
  if (r.error || !r.polyline || r.polyline.length < 2) return null;
  return r.polyline;
}

/** Encadena tramos A→w1→…→B cuando un solo request con muchos vías no alcanza. */
async function chainMidThroughWaypoints(
  pickup: Point,
  dropoff: Point,
  waypointsBetween: Point[],
  routeOpts?: RouteFetchOptions
): Promise<Point[] | null> {
  const chain: Point[] = [pickup, ...waypointsBetween, dropoff];
  if (chain.length < 2) return null;
  const parts: Point[][] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    if (routeOpts?.signal?.aborted) return null;
    const a = chain[i];
    const b = chain[i + 1];
    let seg = await fetchDrivingPolylineOrNull(a, b, [], routeOpts);
    if (!seg || seg.length < 2) {
      seg = distanceMeters(a, b) < 2 ? [a] : [a, b];
    }
    if (seg.length < 2) return null;
    parts.push(seg);
  }
  const merged = concatPolylines(parts);
  return merged.length >= 2 ? merged : null;
}

function shortBridge(a: Point, b: Point): Point[] {
  return distanceMeters(a, b) < 2 ? [a] : [a, b];
}

/**
 * head / tail = tramos de la ruta publicada; mid = ruta por calles joinA→A→waypoints→B→joinB.
 */
export async function buildPassengerMergedRoute(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  waypointsBetween: Point[],
  options?: RouteFetchOptions
): Promise<PassengerMergedSegments | null> {
  if (baseRoute.length < 2) return null;
  if (options?.signal?.aborted) return null;
  const tPu = getPositionAlongPolyline(pickup, baseRoute);
  const tDo = getPositionAlongPolyline(dropoff, baseRoute);
  if (tPu >= tDo - 1e-8) return null;

  const head = slicePolylineBetweenT(baseRoute, 0, tPu);
  const tail = slicePolylineBetweenT(baseRoute, tDo, 1);

  const joinA = head.length >= 2 ? head[head.length - 1] : { ...baseRoute[0] };
  const joinB = tail.length >= 2 ? tail[0] : { ...baseRoute[baseRoute.length - 1] };

  const bridgeA =
    distanceMeters(joinA, pickup) < BRIDGE_ROUTE_MIN_M
      ? shortBridge(joinA, pickup)
      : (await fetchDrivingPolylineOrNull(joinA, pickup, [], options)) ?? shortBridge(joinA, pickup);

  let midCore = await fetchDrivingPolylineOrNull(pickup, dropoff, waypointsBetween, options);
  if (!midCore || midCore.length < 2) {
    midCore = await chainMidThroughWaypoints(pickup, dropoff, waypointsBetween, options);
  }
  if (!midCore || midCore.length < 2) return null;

  const bridgeB =
    distanceMeters(dropoff, joinB) < BRIDGE_ROUTE_MIN_M
      ? shortBridge(dropoff, joinB)
      : (await fetchDrivingPolylineOrNull(dropoff, joinB, [], options)) ?? shortBridge(dropoff, joinB);

  const mid = concatPolylines([bridgeA, midCore, bridgeB]);
  if (mid.length < 2) return null;

  return { head, mid, tail };
}

/** Tramo por calles entre dos puntos respetando la polyline publicada (joins + puentes). */
export async function buildMergedSegmentOnBase(
  baseRoute: Point[],
  fromPt: Point,
  toPt: Point,
  waypointsBetween: Point[]
): Promise<Point[] | null> {
  if (baseRoute.length < 2) return null;
  const tFrom = getPositionAlongPolyline(fromPt, baseRoute);
  const tTo = getPositionAlongPolyline(toPt, baseRoute);
  if (tFrom >= tTo - 1e-8) return null;

  const head = slicePolylineBetweenT(baseRoute, 0, tFrom);
  const tail = slicePolylineBetweenT(baseRoute, tTo, 1);

  const joinA = head.length >= 2 ? head[head.length - 1] : { ...baseRoute[0] };
  const joinB = tail.length >= 2 ? tail[0] : { ...baseRoute[baseRoute.length - 1] };

  const bridgeA =
    distanceMeters(joinA, fromPt) < BRIDGE_ROUTE_MIN_M
      ? shortBridge(joinA, fromPt)
      : (await fetchDrivingPolylineOrNull(joinA, fromPt)) ?? shortBridge(joinA, fromPt);

  const midCore = await fetchDrivingPolylineOrNull(fromPt, toPt, waypointsBetween);
  if (!midCore) return null;

  const bridgeB =
    distanceMeters(toPt, joinB) < BRIDGE_ROUTE_MIN_M
      ? shortBridge(toPt, joinB)
      : (await fetchDrivingPolylineOrNull(toPt, joinB)) ?? shortBridge(toPt, joinB);

  const mid = concatPolylines([bridgeA, midCore, bridgeB]);
  return mid.length >= 2 ? mid : null;
}

const CHAIN_DEDUP_M = 10;

type DriverStopLike = { lat: number; lng: number; stop_order?: number; is_base_stop?: boolean | null };

function visitOrderedAlongBase(baseRoute: Point[], rawPoints: Point[]): Point[] {
  const tagged = rawPoints
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p, i) => ({ p, t: getPositionAlongPolyline(p, baseRoute), ord: i }));
  tagged.sort((a, b) => a.t - b.t || a.ord - b.ord);
  const visit: Point[] = [];
  for (const row of tagged) {
    if (visit.length && distanceMeters(visit[visit.length - 1], row.p) < CHAIN_DEDUP_M) continue;
    visit.push(row.p);
  }
  return visit;
}

/** Inicio/fin publicados + visitas ordenadas en el eje de la base → ruta por tramos. */
async function chainRouteThroughVisitOnBase(
  baseRoute: Point[],
  driverStops: DriverStopLike[],
  visit: Point[]
): Promise<Point[] | null> {
  if (baseRoute.length < 2 || visit.length === 0) return null;

  const start = baseRoute[0];
  const end = baseRoute[baseRoute.length - 1];
  const rawChain = [start, ...visit, end];
  const chain: Point[] = [];
  for (const p of rawChain) {
    if (chain.length && distanceMeters(chain[chain.length - 1], p) < CHAIN_DEDUP_M) continue;
    chain.push(p);
  }
  if (chain.length < 2) return null;

  const parts: Point[][] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const tA = getPositionAlongPolyline(a, baseRoute);
    const tB = getPositionAlongPolyline(b, baseRoute);

    let seg: Point[] | null = null;

    if (tA < tB - 1e-8) {
      const wps = driverIntermediateStopsBetweenT(baseRoute, tA, tB, driverStops);
      seg = await buildMergedSegmentOnBase(baseRoute, a, b, wps);
      if (!seg || seg.length < 2) {
        const fallback = slicePolylineBetweenT(baseRoute, tA, tB);
        if (fallback.length >= 2) seg = fallback;
      }
    } else {
      const lo = Math.min(tA, tB);
      const hi = Math.max(tA, tB);
      const wpsMid = driverIntermediateStopsBetweenT(baseRoute, lo, hi, driverStops);
      seg = await fetchDrivingPolylineOrNull(a, b, wpsMid);
    }

    if (!seg || seg.length < 2) {
      seg = await fetchDrivingPolylineOrNull(a, b, []);
    }
    if (!seg || seg.length < 2) {
      seg = [a, b];
    }
    parts.push(seg);
  }

  const merged = concatPolylines(parts);
  if (merged.length >= 2) return merged;

  const oneShot = await fetchDrivingPolylineOrNull(start, end, visit);
  return oneShot && oneShot.length >= 2 ? oneShot : null;
}

/**
 * Vista conductor: polyline por calles que encadena inicio → subidas/bajadas (orden en la base) → fin,
 * con ajustes de ruta del conductor en cada tramo.
 */
export async function buildDriverMergedRouteThroughBookings(
  baseRoute: Point[],
  driverStops: DriverStopLike[],
  bookings: Array<{ pickup: Point; dropoff: Point }>
): Promise<Point[] | null> {
  if (baseRoute.length < 2 || bookings.length === 0) return null;

  const tagged: { p: Point; t: number; ord: number }[] = [];
  let ord = 0;
  for (const b of bookings) {
    tagged.push({ p: b.pickup, t: getPositionAlongPolyline(b.pickup, baseRoute), ord: ord++ });
    tagged.push({ p: b.dropoff, t: getPositionAlongPolyline(b.dropoff, baseRoute), ord: ord++ });
  }
  tagged.sort((a, b) => a.t - b.t || a.ord - b.ord);

  const visit: Point[] = [];
  for (const row of tagged) {
    if (visit.length && distanceMeters(visit[visit.length - 1], row.p) < CHAIN_DEDUP_M) continue;
    visit.push(row.p);
  }
  if (visit.length === 0) return null;

  return chainRouteThroughVisitOnBase(baseRoute, driverStops, visit);
}

/** Vista visitante: misma lógica con subidas/bajadas desde RPC público. */
export async function buildMergedRouteThroughCoPassengerPoints(
  baseRoute: Point[],
  driverStops: DriverStopLike[],
  pickups: Point[],
  dropoffs: Point[]
): Promise<Point[] | null> {
  if (baseRoute.length < 2) return null;
  const visit = visitOrderedAlongBase(baseRoute, [...pickups, ...dropoffs]);
  if (visit.length === 0) return null;
  return chainRouteThroughVisitOnBase(baseRoute, driverStops, visit);
}
