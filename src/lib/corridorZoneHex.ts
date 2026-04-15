import type L from 'leaflet';

export type HexLatLng = { lat: number; lng: number };

const DEG = Math.PI / 180;

function metersPerDegree(lat: number): { mLat: number; mLng: number } {
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos(lat * DEG);
  return { mLat, mLng: Math.abs(mLng) < 1e3 ? 1e3 : mLng };
}

/**
 * Hexágono regular de tapa plana (flat-top) que contiene el rectángulo centrado en el mismo centro que el bbox.
 * `R = max(2a/√3, b)` con `a` = mitad del ancho en m, `b` = mitad del alto en m.
 */
export function boundsToContainingFlatTopHex(bounds: L.LatLngBounds): HexLatLng[] {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const centerLat = (sw.lat + ne.lat) / 2;
  const centerLng = (sw.lng + ne.lng) / 2;
  const { mLat, mLng } = metersPerDegree(centerLat);
  const halfWm = ((ne.lng - sw.lng) * mLng) / 2;
  const halfHm = ((ne.lat - sw.lat) * mLat) / 2;
  const sqrt3 = Math.sqrt(3);
  const Rm = Math.max((2 * halfWm) / sqrt3, halfHm) * (1 + 1e-9);

  const ring: HexLatLng[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = (Math.PI / 3) * k - Math.PI / 6;
    const x = Rm * Math.cos(ang);
    const y = Rm * Math.sin(ang);
    ring.push({
      lat: centerLat + y / mLat,
      lng: centerLng + x / mLng,
    });
  }
  return ring;
}

function isFinitePair(p: unknown): p is HexLatLng {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/** Lee `hex_latlng` desde JSON de zona (6 vértices {lat,lng}). */
export function parseHexLatlngFromZone(zone: Record<string, unknown>): HexLatLng[] | null {
  const raw = zone.hex_latlng;
  if (!Array.isArray(raw) || raw.length !== 6) return null;
  const out: HexLatLng[] = [];
  for (const p of raw) {
    if (!isFinitePair(p)) return null;
    out.push({ lat: (p as HexLatLng).lat, lng: (p as HexLatLng).lng });
  }
  return out;
}

export function hexRingToLeafletLatLngs(ring: HexLatLng[]): L.LatLngExpression[] {
  return ring.map((p) => [p.lat, p.lng] as L.LatLngExpression);
}

export function leafletRingToHexLatLngs(latlngs: L.LatLng[]): HexLatLng[] {
  const ring = latlngs.map((ll) => ({ lat: ll.lat, lng: ll.lng }));
  if (ring.length >= 2) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a.lat === b.lat && a.lng === b.lng) ring.pop();
  }
  return ring.length === 6 ? ring : [];
}

export function boundsToBox(b: L.LatLngBounds): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return {
    minLat: sw.lat,
    maxLat: ne.lat,
    minLng: sw.lng,
    maxLng: ne.lng,
  };
}
