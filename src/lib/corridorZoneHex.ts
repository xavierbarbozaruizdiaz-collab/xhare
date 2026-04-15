import type L from 'leaflet';

export type HexLatLng = { lat: number; lng: number };

/** Lado del hexágono regular ≈ circumradio R (m). Valor acordado con producto (~150 m). */
export const DEFAULT_CORRIDOR_HEX_EDGE_M = 150;

/** Máximo de celdas a dibujar en el admin (evita colgar Leaflet en zonas enormes). */
export const MAX_CORRIDOR_HEX_PREVIEW_CELLS = 1800;

const DEG = Math.PI / 180;
const SQRT3 = Math.sqrt(3);

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

/** Ray casting: punto (lng, lat) dentro del anillo cerrado (≥3 vértices). */
export function pointInPolygonLngLat(lng: number, lat: number, ring: HexLatLng[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Un hexágono flat-top (mismo criterio que la zona macro) con circumradio = `edgeMeters` (lado ≈ ese valor). */
export function flatTopHexRingAtCenter(centerLat: number, centerLng: number, edgeMeters: number): HexLatLng[] {
  const Rm = Math.max(1, edgeMeters);
  const { mLat, mLng } = metersPerDegree(centerLat);
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

type LocalM = { x: number; y: number };

function toLocalMeters(lat: number, lng: number, cLat: number, cLng: number, mLat: number, mLng: number): LocalM {
  return {
    x: (lng - cLng) * mLng,
    y: (lat - cLat) * mLat,
  };
}

/**
 * Celdas hexagonales (flat-top, lado ≈ `edgeMeters`) cuyo centro cae dentro del polígono `ring`.
 * Si hay demasiadas celdas, aumenta el tamaño efectivo hasta entrar en el tope (y marca `capped`).
 */
export function hexGridCellsInPolygon(
  ring: HexLatLng[],
  edgeMeters: number,
  options?: { maxCells?: number }
): { cells: HexLatLng[][]; effectiveEdgeM: number; capped: boolean } {
  const maxCells = options?.maxCells ?? MAX_CORRIDOR_HEX_PREVIEW_CELLS;
  if (ring.length < 3) return { cells: [], effectiveEdgeM: edgeMeters, capped: false };

  let effective = Math.max(30, Math.min(edgeMeters, 10_000));
  let anyScaled = false;

  for (let attempt = 0; attempt < 12; attempt++) {
    const R = effective;
    const horiz = SQRT3 * R;
    const vert = 1.5 * R;

    const cLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
    const cLng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
    const { mLat, mLng } = metersPerDegree(cLat);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      const { x, y } = toLocalMeters(p.lat, p.lng, cLat, cLng, mLat, mLng);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    minX -= horiz;
    maxX += horiz;
    minY -= vert;
    maxY += vert;

    const rowMin = Math.floor(minY / vert) - 1;
    const rowMax = Math.ceil(maxY / vert) + 1;
    const colMin = Math.floor(minX / horiz) - 2;
    const colMax = Math.ceil(maxX / horiz) + 2;

    const gridSlots = (rowMax - rowMin + 1) * (colMax - colMin + 1);
    if (gridSlots > maxCells * 25 && attempt < 11) {
      effective *= Math.sqrt(gridSlots / (maxCells * 6));
      anyScaled = true;
      continue;
    }

    const cells: HexLatLng[][] = [];
    for (let row = rowMin; row <= rowMax; row++) {
      const rowOdd = ((row % 2) + 2) % 2 === 1;
      const xOff = rowOdd ? horiz / 2 : 0;
      for (let col = colMin; col <= colMax; col++) {
        const x = col * horiz + xOff;
        const y = row * vert;
        const lat = cLat + y / mLat;
        const lng = cLng + x / mLng;
        if (!pointInPolygonLngLat(lng, lat, ring)) continue;
        cells.push(flatTopHexRingAtCenter(lat, lng, R));
        if (cells.length >= maxCells) {
          return { cells, effectiveEdgeM: effective, capped: true };
        }
      }
    }

    return { cells, effectiveEdgeM: effective, capped: anyScaled || cells.length >= maxCells };
  }

  return { cells: [], effectiveEdgeM: effective, capped: true };
}
