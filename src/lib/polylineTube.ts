import type { Point } from '@/types';
import { distanceMeters } from '@/lib/geo';

/** Mismo criterio que `demand-routes/sync`: distancia máxima al eje (m). */
export const DEMAND_SYNC_CORRIDOR_METERS = 2000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Rumbo inicial de `a` → `b` en grados [0,360) desde el norte. */
export function initialBearingDegrees(a: Point, b: Point): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dλ = toRad(b.lng - a.lng);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Punto a distancia `distM` metros desde `from` con rumbo `bearingDeg` (N=0, E=90). */
export function destinationPointMeters(from: Point, bearingDeg: number, distM: number): Point {
  const R = 6371000;
  const δ = distM / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(from.lat);
  const λ1 = toRad(from.lng);
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Interpola lineal lat/lng (suficiente para segmentos cortos de despacho). */
function interpolate(a: Point, b: Point, t: number): Point {
  return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
}

/** Inserta puntos para que ningún tramo supere `maxSegM` metros. */
function densifyPolyline(points: Point[], maxSegM: number): Point[] {
  if (points.length < 2) return [...points];
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    out.push(points[i]);
    if (i === points.length - 1) break;
    const a = points[i];
    const b = points[i + 1];
    const d = distanceMeters(a, b);
    const steps = Math.max(1, Math.ceil(d / maxSegM));
    for (let s = 1; s < steps; s++) {
      out.push(interpolate(a, b, s / steps));
    }
  }
  return out;
}

/**
 * Anillo cerrado aproximado del “tubo” alrededor de la polilínea (buffer constante en metros).
 * Usa densificación + desplazamiento perpendicular por rumbo; sirve para visualización admin.
 */
export function tubePolygonFromPolyline(points: Point[], radiusMeters: number): Point[] | null {
  if (points.length < 2) return null;
  const dense = densifyPolyline(points, 400);
  if (dense.length < 2) return null;

  const left: Point[] = [];
  const right: Point[] = [];

  for (let i = 0; i < dense.length; i++) {
    let brng: number;
    if (i === 0) {
      brng = initialBearingDegrees(dense[0], dense[1]);
    } else if (i === dense.length - 1) {
      brng = initialBearingDegrees(dense[i - 1], dense[i]);
    } else {
      const b1 = initialBearingDegrees(dense[i - 1], dense[i]);
      const b2 = initialBearingDegrees(dense[i], dense[i + 1]);
      const x = Math.cos(toRad(b1)) + Math.cos(toRad(b2));
      const y = Math.sin(toRad(b1)) + Math.sin(toRad(b2));
      brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
    left.push(destinationPointMeters(dense[i], brng - 90, radiusMeters));
    right.push(destinationPointMeters(dense[i], brng + 90, radiusMeters));
  }

  const ring: Point[] = [...left];
  for (let j = right.length - 1; j >= 0; j--) {
    ring.push(right[j]);
  }
  ring.push(left[0]);
  return ring;
}
