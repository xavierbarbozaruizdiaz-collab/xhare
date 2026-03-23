/**
 * Ruta mostrada al reservar: recorte de la polyline del conductor (gris) + OSRM que pasa por A, waypoints y B (verde).
 * `waypointsBetween` debe incluir paradas extra del pasajero y paradas intermedias del conductor en el tramo A–B.
 */
import { fetchRoute } from '../backend/routeApi';
import { distanceMeters, getPositionAlongPolyline, slicePolylineBetweenT, type Point } from './geo';
import { driverIntermediateStopsBetweenT } from './passengerRouteWaypoints';

export type PassengerMergedSegments = { head: Point[]; mid: Point[]; tail: Point[] };

const BRIDGE_OSRM_MIN_M = 45;

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

async function osrmOrNull(origin: Point, destination: Point, waypoints: Point[] = []): Promise<Point[] | null> {
  const r = await fetchRoute(origin, destination, waypoints);
  if (r.error || !r.polyline || r.polyline.length < 2) return null;
  return r.polyline;
}

function shortBridge(a: Point, b: Point): Point[] {
  return distanceMeters(a, b) < 2 ? [a] : [a, b];
}

/**
 * head / tail = tramos de la ruta publicada; mid = OSRM(joinA→A→waypointsBetween→B→joinB).
 * Devuelve null si falla el tramo central OSRM (el caller puede seguir con el recorte solo sobre la base).
 */
export async function buildPassengerMergedRoute(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  waypointsBetween: Point[]
): Promise<PassengerMergedSegments | null> {
  if (baseRoute.length < 2) return null;
  const tPu = getPositionAlongPolyline(pickup, baseRoute);
  const tDo = getPositionAlongPolyline(dropoff, baseRoute);
  if (tPu >= tDo - 1e-8) return null;

  const head = slicePolylineBetweenT(baseRoute, 0, tPu);
  const tail = slicePolylineBetweenT(baseRoute, tDo, 1);

  const joinA = head.length >= 2 ? head[head.length - 1] : { ...baseRoute[0] };
  const joinB = tail.length >= 2 ? tail[0] : { ...baseRoute[baseRoute.length - 1] };

  const bridgeA =
    distanceMeters(joinA, pickup) < BRIDGE_OSRM_MIN_M
      ? shortBridge(joinA, pickup)
      : (await osrmOrNull(joinA, pickup)) ?? shortBridge(joinA, pickup);

  const midCore = await osrmOrNull(pickup, dropoff, waypointsBetween);
  if (!midCore) return null;

  const bridgeB =
    distanceMeters(dropoff, joinB) < BRIDGE_OSRM_MIN_M
      ? shortBridge(dropoff, joinB)
      : (await osrmOrNull(dropoff, joinB)) ?? shortBridge(dropoff, joinB);

  const mid = concatPolylines([bridgeA, midCore, bridgeB]);
  if (mid.length < 2) return null;

  return { head, mid, tail };
}

/**
 * Tramo OSRM entre dos puntos respetando la polyline publicada (joins en la base + puentes), sin incluir head/tail del viaje completo.
 */
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
    distanceMeters(joinA, fromPt) < BRIDGE_OSRM_MIN_M
      ? shortBridge(joinA, fromPt)
      : (await osrmOrNull(joinA, fromPt)) ?? shortBridge(joinA, fromPt);

  const midCore = await osrmOrNull(fromPt, toPt, waypointsBetween);
  if (!midCore) return null;

  const bridgeB =
    distanceMeters(toPt, joinB) < BRIDGE_OSRM_MIN_M
      ? shortBridge(toPt, joinB)
      : (await osrmOrNull(toPt, joinB)) ?? shortBridge(toPt, joinB);

  const mid = concatPolylines([bridgeA, midCore, bridgeB]);
  return mid.length >= 2 ? mid : null;
}

const CHAIN_DEDUP_M = 10;

type DriverStopLike = { lat: number; lng: number; stop_order?: number };

/**
 * Vista conductor: una sola polyline OSRM que encadena inicio → subidas/bajadas de reservas (orden por progreso en la base)
 * → fin, insertando paradas intermedias del conductor en cada tramo.
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
    if (tA >= tB - 1e-8) return null;
    const wps = driverIntermediateStopsBetweenT(baseRoute, tA, tB, driverStops);
    const seg = await buildMergedSegmentOnBase(baseRoute, a, b, wps);
    if (!seg || seg.length < 2) return null;
    parts.push(seg);
  }

  return concatPolylines(parts);
}
