/**
 * Polilínea única (mapa gris en reserva): OSRM que une paradas del conductor + subidas/bajadas
 * de pasajeros ya reservados, ordenadas por progreso sobre la ruta publicada del conductor.
 *
 * Escala: con muchos pasajeros, una sola URL con decenas de `via` falla a menudo; encadenar
 * A→B→C en N−1 peticiones no escala (lento + riesgo de rate limit 40/min en `/api/route/polyline`).
 * Por eso usamos **chunks** (varios waypoints por petición, tope conservador) y solo caemos al
 * encadenamiento de a pares como último recurso antes del polyline solo del conductor.
 */
import { fetchRoute } from '../backend/routeApi';
import { distanceMeters, getPositionAlongPolyline, type Point } from './geo';

const DEDUP_M = 12;
const JOIN_TOL_M = 14;

/** Máximo de `via` intermedio por petición (origen + estos + destino = maxVia+2 coords). */
const MAX_VIA_PER_REQUEST = 8;

function concatPolylineParts(parts: Point[][]): Point[] | null {
  const out: Point[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const p = part[i];
      if (out.length === 0) {
        out.push({ ...p });
        continue;
      }
      const last = out[out.length - 1];
      if (i === 0 && distanceMeters(last, p) < JOIN_TOL_M) continue;
      out.push({ ...p });
    }
  }
  return out.length >= 2 ? out : null;
}

/**
 * Varias peticiones OSRM, cada una con hasta MAX_VIA_PER_REQUEST waypoints.
 * Ej. 40 paradas → ~5 llamadas en lugar de 39 en el encadenamiento de a pares.
 */
async function fetchChunkedOsrm(ordered: Point[]): Promise<Point[] | null> {
  if (ordered.length < 2) return null;
  if (ordered.length === 2) {
    const r = await fetchRoute(ordered[0], ordered[1], []);
    return r.polyline && r.polyline.length >= 2
      ? r.polyline.map((x) => ({ lat: x.lat, lng: x.lng }))
      : null;
  }
  const parts: Point[][] = [];
  let i = 0;
  while (i < ordered.length - 1) {
    const end = Math.min(i + MAX_VIA_PER_REQUEST + 1, ordered.length - 1);
    const chunk = ordered.slice(i, end + 1);
    const o = chunk[0];
    const d = chunk[chunk.length - 1];
    const wps = chunk.slice(1, -1);
    const r = await fetchRoute(o, d, wps);
    if (r.error || !r.polyline || r.polyline.length < 2) return null;
    parts.push(r.polyline.map((x) => ({ lat: x.lat, lng: x.lng })));
    i = end;
  }
  return concatPolylineParts(parts);
}

/** Encadena A→B→C… con OSRM en cada par consecutivo (último recurso; costoso si hay muchas paradas). */
async function chainOsrmThroughPoints(ordered: Point[]): Promise<Point[] | null> {
  if (ordered.length < 2) return null;
  const parts: Point[][] = [];
  for (let j = 0; j < ordered.length - 1; j++) {
    const a = ordered[j];
    const b = ordered[j + 1];
    const r = await fetchRoute(a, b, []);
    let seg: Point[] | null =
      r.polyline && r.polyline.length >= 2 ? r.polyline.map((x) => ({ lat: x.lat, lng: x.lng })) : null;
    if (!seg || seg.length < 2) {
      seg = distanceMeters(a, b) < 2 ? [a] : [a, b];
    }
    if (seg.length < 2) return null;
    parts.push(seg);
  }
  return concatPolylineParts(parts);
}

export type MasterBookRideStop = { lat: number; lng: number; stop_order?: number };

export async function buildMasterBookRidePolyline(params: {
  driverBaseRoute: Point[];
  driverStops: MasterBookRideStop[];
  existingPickups: Array<{ lat: number; lng: number }>;
  existingDropoffs: Array<{ lat: number; lng: number }>;
}): Promise<Point[]> {
  const { driverBaseRoute: base, driverStops, existingPickups, existingDropoffs } = params;
  if (base.length < 2) return [];

  const tagged: { p: Point; t: number; ord: number }[] = [];
  let ord = 0;
  for (const s of driverStops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const p = { lat: s.lat, lng: s.lng };
    tagged.push({ p, t: getPositionAlongPolyline(p, base), ord: ord++ });
  }
  for (const x of existingPickups) {
    if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)) continue;
    const p = { lat: x.lat, lng: x.lng };
    tagged.push({ p, t: getPositionAlongPolyline(p, base), ord: ord++ });
  }
  for (const x of existingDropoffs) {
    if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)) continue;
    const p = { lat: x.lat, lng: x.lng };
    tagged.push({ p, t: getPositionAlongPolyline(p, base), ord: ord++ });
  }

  if (tagged.length < 2) return [...base];

  tagged.sort((a, b) => a.t - b.t || a.ord - b.ord);
  const deduped: Point[] = [];
  for (const { p } of tagged) {
    if (deduped.length === 0 || distanceMeters(deduped[deduped.length - 1], p) >= DEDUP_M) {
      deduped.push(p);
    }
  }
  if (deduped.length < 2) return [...base];

  const origin = deduped[0];
  const destination = deduped[deduped.length - 1];
  const waypoints = deduped.slice(1, -1);

  const fewStops = waypoints.length <= 5 && deduped.length < 12;
  if (fewStops) {
    const res = await fetchRoute(origin, destination, waypoints);
    if (!res.error && res.polyline && res.polyline.length >= 2) {
      return res.polyline.map((x) => ({ lat: x.lat, lng: x.lng }));
    }
  }

  const chunked = await fetchChunkedOsrm(deduped);
  if (chunked && chunked.length >= 2) return chunked;

  if (!fewStops) {
    const res = await fetchRoute(origin, destination, waypoints);
    if (!res.error && res.polyline && res.polyline.length >= 2) {
      return res.polyline.map((x) => ({ lat: x.lat, lng: x.lng }));
    }
  }

  const chained = await chainOsrmThroughPoints(deduped);
  if (chained && chained.length >= 2) return chained;

  return [...base];
}
