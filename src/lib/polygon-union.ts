import area from '@turf/area';
import { featureCollection, polygon } from '@turf/helpers';
import union from '@turf/union';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export type LatLng = { lat: number; lng: number };

function ringToPolygonFeature(ring: LatLng[]): Feature<Polygon> | null {
  if (ring.length < 3) return null;
  const coords = ring.map((p) => [p.lng, p.lat] as [number, number]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coords.push([first[0], first[1]]);
  }
  try {
    return polygon([coords]);
  } catch {
    return null;
  }
}

function featureToRing(f: Feature<Polygon | MultiPolygon>): LatLng[] | null {
  const geom = f.geometry;
  if (geom.type === 'Polygon') {
    const ext = geom.coordinates[0];
    if (!ext || ext.length < 4) return null;
    const out = ext.slice(0, -1).map((coord) => ({ lat: coord[1], lng: coord[0] }));
    return out.length >= 3 ? out : null;
  }
  if (geom.type === 'MultiPolygon') {
    let best: LatLng[] | null = null;
    let bestA = -1;
    for (const poly of geom.coordinates) {
      const ext = poly[0];
      if (!ext || ext.length < 4) continue;
      const feat = polygon([ext]);
      const a = area(feat);
      if (a > bestA) {
        const out = ext.slice(0, -1).map((coord) => ({ lat: coord[1], lng: coord[0] }));
        if (out.length >= 3) {
          best = out;
          bestA = a;
        }
      }
    }
    return best;
  }
  return null;
}

/** Unión de dos anillos (lat/lng). Devuelve el contorno exterior unificado o null si falla. */
export function unionPolygonRings(a: LatLng[], b: LatLng[]): LatLng[] | null {
  const fa = ringToPolygonFeature(a);
  const fb = ringToPolygonFeature(b);
  if (!fa || !fb) return null;
  try {
    const merged = union(featureCollection([fa, fb]));
    if (!merged) return null;
    return featureToRing(merged);
  } catch {
    return null;
  }
}
