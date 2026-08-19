/**
 * Ajusta un lat/lng a la vía más cercana (calle/ruta) para no marcar “en el medio de la nada”.
 * Preferencia: Google Roads nearestRoads; fallback OSRM nearest (driving).
 */

export type SnapToRoadResult = {
  lat: number;
  lng: number;
  /** Distancia entre el punto pedido y el snapped. */
  distanceMeters: number;
  source: 'google' | 'osrm';
};

/** Si el snap está más lejos, se considera fuera de calle usable. */
export const SNAP_TO_ROAD_MAX_METERS = 80;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function snapWithGoogle(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<SnapToRoadResult | null> {
  const url =
    `https://roads.googleapis.com/v1/nearestRoads?points=${encodeURIComponent(`${lat},${lng}`)}` +
    `&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    snappedPoints?: Array<{ location?: { latitude?: number; longitude?: number } }>;
  };
  const loc = data.snappedPoints?.[0]?.location;
  if (
    !loc ||
    typeof loc.latitude !== 'number' ||
    typeof loc.longitude !== 'number' ||
    !Number.isFinite(loc.latitude) ||
    !Number.isFinite(loc.longitude)
  ) {
    return null;
  }
  const snapped = { lat: loc.latitude, lng: loc.longitude };
  return {
    ...snapped,
    distanceMeters: haversineMeters({ lat, lng }, snapped),
    source: 'google',
  };
}

async function snapWithOsrm(lat: number, lng: number): Promise<SnapToRoadResult | null> {
  const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'xhare-transporte/1.0' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    code?: string;
    waypoints?: Array<{ location?: [number, number]; distance?: number }>;
  };
  if (data.code !== 'Ok') return null;
  const wp = data.waypoints?.[0];
  const loc = wp?.location;
  if (!loc || loc.length < 2) return null;
  const snapped = { lat: loc[1], lng: loc[0] };
  const distanceMeters =
    typeof wp.distance === 'number' && Number.isFinite(wp.distance)
      ? wp.distance
      : haversineMeters({ lat, lng }, snapped);
  return { ...snapped, distanceMeters, source: 'osrm' };
}

/**
 * Devuelve el punto sobre la calle más cercana, o null si no hay vía cercana / falla el proveedor.
 */
export async function snapLatLngToNearestRoad(
  lat: number,
  lng: number,
  apiKey?: string | null,
): Promise<SnapToRoadResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = apiKey?.trim() || null;
  if (key) {
    try {
      const g = await snapWithGoogle(lat, lng, key);
      if (g && g.distanceMeters <= SNAP_TO_ROAD_MAX_METERS) return g;
      if (g && g.distanceMeters > SNAP_TO_ROAD_MAX_METERS) return null;
    } catch {
      // fallback OSRM
    }
  }
  try {
    const o = await snapWithOsrm(lat, lng);
    if (o && o.distanceMeters <= SNAP_TO_ROAD_MAX_METERS) return o;
  } catch {
    return null;
  }
  return null;
}
