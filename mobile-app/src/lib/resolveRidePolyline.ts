/**
 * Misma lógica que el detalle del viaje: polyline guardada (OSRM al publicar) o fetch OSRM, o línea entre paradas.
 * BookRide y RideDetail deben usar esto para que la ruta no “cambie” entre pantallas.
 */
import { fetchRoute } from '../backend/routeApi';
import { buildPolylineFromRide, type Point } from './geo';

export type RideStopLike = { lat: number; lng: number; stop_order?: number };

export type ResolvedPolylineSource = 'stored' | 'osrm' | 'chord' | 'empty';

export type ResolvedPolyline = {
  points: Point[];
  source: ResolvedPolylineSource;
};

export function resolveOriginDestWaypoints(
  ride: Record<string, unknown>,
  stops: RideStopLike[]
): { origin: Point; destination: Point; waypoints: Point[] } | null {
  const olat = Number(ride.origin_lat);
  const olng = Number(ride.origin_lng);
  const dlat = Number(ride.destination_lat);
  const dlng = Number(ride.destination_lng);
  if (Number.isFinite(olat) && Number.isFinite(olng) && Number.isFinite(dlat) && Number.isFinite(dlng)) {
    const wps: Point[] = [];
    const sorted = [...stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    sorted.forEach((s, i) => {
      if (i === 0 || i === sorted.length - 1) return;
      if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) wps.push({ lat: s.lat, lng: s.lng });
    });
    return { origin: { lat: olat, lng: olng }, destination: { lat: dlat, lng: dlng }, waypoints: wps };
  }
  if (stops.length >= 2) {
    const sorted = [...stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    const origin = { lat: sorted[0].lat, lng: sorted[0].lng };
    const destination = { lat: sorted[sorted.length - 1].lat, lng: sorted[sorted.length - 1].lng };
    const waypoints = sorted.slice(1, -1).map((s) => ({ lat: s.lat, lng: s.lng }));
    return { origin, destination, waypoints };
  }
  return null;
}

export async function loadRidePolyline(
  ride: Record<string, unknown>,
  stops: RideStopLike[]
): Promise<ResolvedPolyline> {
  const rawPoly = ride.base_route_polyline;
  const hasDbPoly = Array.isArray(rawPoly) && rawPoly.length >= 2;
  const fromBuild = buildPolylineFromRide({ ...ride, ride_stops: stops });

  if (hasDbPoly && fromBuild.length >= 2) {
    return { points: fromBuild, source: 'stored' };
  }

  const od = resolveOriginDestWaypoints(ride, stops);
  if (od) {
    const res = await fetchRoute(od.origin, od.destination, od.waypoints);
    if (res.polyline && res.polyline.length >= 2) {
      return { points: res.polyline, source: 'osrm' };
    }
  }

  if (fromBuild.length >= 2) {
    return { points: fromBuild, source: 'chord' };
  }
  return { points: [], source: 'empty' };
}

export function captionForPolylineSource(source: ResolvedPolylineSource): string | null {
  switch (source) {
    case 'stored':
      return 'Recorrido por calles definido al publicar el viaje.';
    case 'osrm':
      return 'Recorrido por calles (OSRM).';
    case 'chord':
      return 'Línea entre paradas del conductor (sin ruta por calles guardada).';
    default:
      return null;
  }
}
