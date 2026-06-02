/**
 * Polilínea única (mapa gris en reserva): Google Routes vía `/api/route/polyline`, uniendo
 * ajustes de ruta del conductor + subidas/bajadas ya reservadas, ordenadas sobre la ruta publicada.
 *
 * Escala: muchos puntos → varios tramos (chunks) antes de encadenar A→B→C de a pares.
 */
import { fetchRoute, type RouteFetchOptions } from '../backend/routeApi';
import { distanceMeters, getPositionAlongPolyline, type Point } from './geo';
import { filterRouteAdjustmentStops, isOperationalDriverStop } from './rideStopKinds';

const DEDUP_M = 12;
const JOIN_TOL_M = 14;

/**
 * Orden de visitas en mapa (Llegué / lista): solo origen/destino publicados + reservas;
 * no incluye ajustes de ruta (is_base_stop false).
 */
export type OrderedMapVisitRow = {
  kind: 'published' | 'pickup' | 'dropoff';
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  rideStopId?: string;
  bookingId?: string;
  stopOrder?: number;
};

export type DriverStopForMapOrder = {
  id: string;
  lat: number;
  lng: number;
  label: string | null;
  stop_order: number;
  is_base_stop?: boolean | null;
};

export type BookingGeoForMapOrder = {
  id: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  pickup_label: string | null;
  dropoff_label: string | null;
};

export function computeOrderedVisitStopsForMap(params: {
  driverBaseRoute: Point[];
  driverStops: DriverStopForMapOrder[];
  bookings: BookingGeoForMapOrder[];
}): OrderedMapVisitRow[] {
  const { driverBaseRoute: base, driverStops, bookings } = params;
  if (base.length < 2) return [];

  type Tagged = { p: Point; t: number; ord: number; row: OrderedMapVisitRow };
  const tagged: Tagged[] = [];
  let ord = 0;

  const sortedDriver = [...driverStops]
    .filter(isOperationalDriverStop)
    .sort((a, b) => a.stop_order - b.stop_order);
  for (const s of sortedDriver) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const p = { lat: s.lat, lng: s.lng };
    tagged.push({
      p,
      t: getPositionAlongPolyline(p, base),
      ord: ord++,
      row: {
        kind: 'published',
        lat: p.lat,
        lng: p.lng,
        title: s.label?.trim() || 'Punto de tu ruta publicada',
        rideStopId: s.id,
        stopOrder: s.stop_order,
      },
    });
  }

  const active = bookings.filter((b) => b.status !== 'cancelled');
  for (const b of active) {
    const lat = Number(b.pickup_lat);
    const lng = Number(b.pickup_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const p = { lat, lng };
      tagged.push({
        p,
        t: getPositionAlongPolyline(p, base),
        ord: ord++,
        row: {
          kind: 'pickup',
          lat,
          lng,
          title: b.pickup_label?.trim() || 'Subida de pasajero',
          bookingId: b.id,
        },
      });
    }
  }
  for (const b of active) {
    const lat = Number(b.dropoff_lat);
    const lng = Number(b.dropoff_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const p = { lat, lng };
      tagged.push({
        p,
        t: getPositionAlongPolyline(p, base),
        ord: ord++,
        row: {
          kind: 'dropoff',
          lat,
          lng,
          title: b.dropoff_label?.trim() || 'Bajada de pasajero',
          bookingId: b.id,
        },
      });
    }
  }

  if (tagged.length === 0) return [];

  tagged.sort((a, b) => a.t - b.t || a.ord - b.ord);
  const out: OrderedMapVisitRow[] = [];

  for (const x of tagged) {
    if (out.length === 0) {
      out.push({ ...x.row });
      continue;
    }
    const last = out[out.length - 1];
    if (distanceMeters({ lat: last.lat, lng: last.lng }, x.p) < DEDUP_M) {
      const piece =
        x.row.kind === 'published'
          ? x.row.title
          : x.row.kind === 'pickup'
            ? `Subida: ${x.row.title}`
            : `Bajada: ${x.row.title}`;
      last.subtitle = last.subtitle ? `${last.subtitle} · ${piece}` : `También: ${piece}`;
      continue;
    }
    out.push({ ...x.row });
  }

  return out;
}

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

/** Varias peticiones a `/api/route/polyline`, cada una con hasta MAX_VIA_PER_REQUEST waypoints. */
async function fetchChunkedOsrm(ordered: Point[], routeOpts?: RouteFetchOptions): Promise<Point[] | null> {
  if (ordered.length < 2) return null;
  if (ordered.length === 2) {
    const r = await fetchRoute(ordered[0], ordered[1], [], routeOpts);
    if (r.aborted) return null;
    return r.polyline && r.polyline.length >= 2
      ? r.polyline.map((x) => ({ lat: x.lat, lng: x.lng }))
      : null;
  }
  const parts: Point[][] = [];
  let i = 0;
  while (i < ordered.length - 1) {
    if (routeOpts?.signal?.aborted) return null;
    const end = Math.min(i + MAX_VIA_PER_REQUEST + 1, ordered.length - 1);
    const chunk = ordered.slice(i, end + 1);
    const o = chunk[0];
    const d = chunk[chunk.length - 1];
    const wps = chunk.slice(1, -1);
    const r = await fetchRoute(o, d, wps, routeOpts);
    if (r.aborted) return null;
    if (r.error || !r.polyline || r.polyline.length < 2) return null;
    parts.push(r.polyline.map((x) => ({ lat: x.lat, lng: x.lng })));
    i = end;
  }
  return concatPolylineParts(parts);
}

/** Encadena A→B→C… por calles en cada par consecutivo (último recurso). */
async function chainOsrmThroughPoints(ordered: Point[], routeOpts?: RouteFetchOptions): Promise<Point[] | null> {
  if (ordered.length < 2) return null;
  const parts: Point[][] = [];
  for (let j = 0; j < ordered.length - 1; j++) {
    if (routeOpts?.signal?.aborted) return null;
    const a = ordered[j];
    const b = ordered[j + 1];
    const r = await fetchRoute(a, b, [], routeOpts);
    if (r.aborted) return null;
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

export type MasterBookRideStop = {
  lat: number;
  lng: number;
  stop_order?: number;
  is_base_stop?: boolean | null;
};

export async function buildMasterBookRidePolyline(params: {
  driverBaseRoute: Point[];
  driverStops: MasterBookRideStop[];
  existingPickups: Array<{ lat: number; lng: number }>;
  existingDropoffs: Array<{ lat: number; lng: number }>;
  /** Cancelación: al abortar se devuelve la poly base del conductor sin seguir encadenando rutas. */
  signal?: AbortSignal;
}): Promise<Point[]> {
  const { driverBaseRoute: base, driverStops, existingPickups, existingDropoffs, signal } = params;
  const routeOpts: RouteFetchOptions | undefined = signal ? { signal } : undefined;
  if (base.length < 2) return [];
  if (signal?.aborted) return [];

  /** Origen/destino ya están en `base`; solo los ajustes de ruta son vías extra al reordenar con reservas. */
  const driverRouteVias = filterRouteAdjustmentStops(driverStops);

  const tagged: { p: Point; t: number; ord: number }[] = [];
  let ord = 0;
  for (const s of driverRouteVias) {
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
    const res = await fetchRoute(origin, destination, waypoints, routeOpts);
    if (signal?.aborted) return [...base];
    if (!res.aborted && !res.error && res.polyline && res.polyline.length >= 2) {
      return res.polyline.map((x) => ({ lat: x.lat, lng: x.lng }));
    }
  }

  const chunked = await fetchChunkedOsrm(deduped, routeOpts);
  if (signal?.aborted) return [...base];
  if (chunked && chunked.length >= 2) return chunked;

  if (!fewStops) {
    const res = await fetchRoute(origin, destination, waypoints, routeOpts);
    if (signal?.aborted) return [...base];
    if (!res.aborted && !res.error && res.polyline && res.polyline.length >= 2) {
      return res.polyline.map((x) => ({ lat: x.lat, lng: x.lng }));
    }
  }

  const chained = await chainOsrmThroughPoints(deduped, routeOpts);
  if (signal?.aborted) return [...base];
  if (chained && chained.length >= 2) return chained;

  return [...base];
}
