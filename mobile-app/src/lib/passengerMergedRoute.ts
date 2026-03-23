/**
 * Ruta mostrada al reservar: recorte de la polyline del conductor (gris) + OSRM que pasa por A, paradas y B (verde).
 */
import { fetchRoute } from '../backend/routeApi';
import { distanceMeters, getPositionAlongPolyline, slicePolylineBetweenT, type Point } from './geo';

export type PassengerMergedSegments = { head: Point[]; mid: Point[]; tail: Point[] };

const BRIDGE_OSRM_MIN_M = 45;

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
 * head / tail = tramos de la ruta publicada; mid = OSRM(joinA→A→extras→B→joinB).
 * Devuelve null si falla el tramo central OSRM (el caller puede seguir con el recorte solo sobre la base).
 */
export async function buildPassengerMergedRoute(
  baseRoute: Point[],
  pickup: Point,
  dropoff: Point,
  extrasOrdered: Point[]
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

  const midCore = await osrmOrNull(pickup, dropoff, extrasOrdered);
  if (!midCore) return null;

  const bridgeB =
    distanceMeters(dropoff, joinB) < BRIDGE_OSRM_MIN_M
      ? shortBridge(dropoff, joinB)
      : (await osrmOrNull(dropoff, joinB)) ?? shortBridge(dropoff, joinB);

  const mid = concatPolylines([bridgeA, midCore, bridgeB]);
  if (mid.length < 2) return null;

  return { head, mid, tail };
}
