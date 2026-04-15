import type L from 'leaflet';

export type HexLatLng = { lat: number; lng: number };
export type CityPolygon = {
  id: string;
  name: string;
  active: boolean;
  polygon_latlng: HexLatLng[];
};

/** Lado del hexágono regular ≈ circumradio R (m). Valor acordado con producto (~150 m). */
export const DEFAULT_CORRIDOR_HEX_EDGE_M = 150;

/** Máximo de celdas a dibujar en el admin (evita colgar Leaflet en zonas enormes). */
export const MAX_CORRIDOR_HEX_PREVIEW_CELLS = 1800;

const DEG = Math.PI / 180;
const SQRT3 = Math.sqrt(3);
const EARTH_RADIUS_M = 6_378_137;

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

/** Lee `polygon_latlng` desde JSON de zona (anillo de >=3 vértices {lat,lng}). */
export function parsePolygonLatlngFromZone(zone: Record<string, unknown>): HexLatLng[] | null {
  const raw = zone.polygon_latlng;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out: HexLatLng[] = [];
  for (const p of raw) {
    if (!isFinitePair(p)) return null;
    out.push({ lat: (p as HexLatLng).lat, lng: (p as HexLatLng).lng });
  }
  return out.length >= 3 ? out : null;
}

/** Lee `city_polygons` desde JSON de zona. */
export function parseCityPolygonsFromZone(zone: Record<string, unknown>): CityPolygon[] {
  const raw = zone.city_polygons;
  if (!Array.isArray(raw)) return [];
  const out: CityPolygon[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name : '';
    const active = o.active !== false;
    const polyRaw = o.polygon_latlng;
    if (!id || !name || !Array.isArray(polyRaw) || polyRaw.length < 3) continue;
    const poly: HexLatLng[] = [];
    let valid = true;
    for (const p of polyRaw) {
      if (!isFinitePair(p)) {
        valid = false;
        break;
      }
      poly.push({ lat: (p as HexLatLng).lat, lng: (p as HexLatLng).lng });
    }
    if (!valid || poly.length < 3) continue;
    out.push({ id, name, active, polygon_latlng: poly });
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

/** Convierte vértices Leaflet a anillo de polígono (sin forzar 6 puntos). */
export function leafletRingToPolygonLatLngs(latlngs: L.LatLng[]): HexLatLng[] {
  const ring = latlngs.map((ll) => ({ lat: ll.lat, lng: ll.lng }));
  if (ring.length >= 2) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a.lat === b.lat && a.lng === b.lng) ring.pop();
  }
  return ring.length >= 3 ? ring : [];
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

type XY = { x: number; y: number };

function toMercatorXY(lat: number, lng: number): XY {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: (EARTH_RADIUS_M * lng * Math.PI) / 180,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clampedLat * DEG) / 2)),
  };
}

function fromMercatorXY(x: number, y: number): XY {
  const lng = (x * 180) / (Math.PI * EARTH_RADIUS_M);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) / DEG;
  return { x: lat, y: lng };
}

function pointInPolygonXY(p: XY, ring: XY[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function orient(a: XY, b: XY, c: XY): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  const minX = Math.min(a.x, b.x) - 1e-9;
  const maxX = Math.max(a.x, b.x) + 1e-9;
  const minY = Math.min(a.y, b.y) - 1e-9;
  const maxY = Math.max(a.y, b.y) + 1e-9;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function segmentsIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  if ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) {
    if ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)) return true;
  }
  if (Math.abs(o1) < 1e-9 && onSegment(a1, a2, b1)) return true;
  if (Math.abs(o2) < 1e-9 && onSegment(a1, a2, b2)) return true;
  if (Math.abs(o3) < 1e-9 && onSegment(b1, b2, a1)) return true;
  if (Math.abs(o4) < 1e-9 && onSegment(b1, b2, a2)) return true;
  return false;
}

function polygonsIntersectXY(a: XY[], b: XY[]): boolean {
  for (const p of a) {
    if (pointInPolygonXY(p, b)) return true;
  }
  for (const p of b) {
    if (pointInPolygonXY(p, a)) return true;
  }
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function flatTopHexXYAtCenter(cx: number, cy: number, edgeMeters: number): XY[] {
  const R = Math.max(1, edgeMeters);
  const ring: XY[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = (Math.PI / 3) * k - Math.PI / 6;
    ring.push({ x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) });
  }
  return ring;
}

function xyRingToLatLng(ring: XY[]): HexLatLng[] {
  return ring.map((p) => {
    const ll = fromMercatorXY(p.x, p.y);
    return { lat: ll.x, lng: ll.y };
  });
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

/**
 * Malla hex global anclada (WebMercator) para que celdas entre polígonos vecinos compartan borde.
 * Incluye celdas que tocan/intersectan el polígono (no recorta celdas de borde).
 */
export function hexGridCellsTouchingPolygonGlobal(
  ring: HexLatLng[],
  edgeMeters: number,
  options?: { maxCells?: number }
): { cells: HexLatLng[][]; effectiveEdgeM: number; capped: boolean } {
  const maxCells = options?.maxCells ?? MAX_CORRIDOR_HEX_PREVIEW_CELLS;
  if (ring.length < 3) return { cells: [], effectiveEdgeM: edgeMeters, capped: false };
  let effective = Math.max(30, Math.min(edgeMeters, 10_000));
  let anyScaled = false;
  const polyXY = ring.map((p) => toMercatorXY(p.lat, p.lng));

  for (let attempt = 0; attempt < 12; attempt++) {
    const R = effective;
    const horiz = SQRT3 * R;
    const vert = 1.5 * R;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of polyXY) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
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
        const cx = col * horiz + xOff;
        const cy = row * vert;
        const hexXY = flatTopHexXYAtCenter(cx, cy, R);
        if (!polygonsIntersectXY(hexXY, polyXY)) continue;
        cells.push(xyRingToLatLng(hexXY));
        if (cells.length >= maxCells) {
          return { cells, effectiveEdgeM: effective, capped: true };
        }
      }
    }

    return { cells, effectiveEdgeM: effective, capped: anyScaled || cells.length >= maxCells };
  }

  return { cells: [], effectiveEdgeM: effective, capped: true };
}
