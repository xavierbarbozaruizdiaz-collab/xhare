import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CORRIDOR_IMPORT_DEPARTMENTS,
  departmentMetroName,
  departmentMetroSlug,
  isCorridorImportDepartmentId,
  PARAGUAY_DEPARTMENT_PRESETS,
  type CorridorImportDepartmentId,
  type ParaguayDepartmentPreset,
} from '@/lib/admin/paraguay-department-presets';

export type { CorridorImportDepartmentId };
export { CORRIDOR_IMPORT_DEPARTMENTS, isCorridorImportDepartmentId };

export type CorridorZoneTemplateId = CorridorImportDepartmentId;

export function isCorridorZoneTemplateId(v: unknown): v is CorridorZoneTemplateId {
  return isCorridorImportDepartmentId(v);
}

export function corridorZoneTemplateForDepartment(
  departmentId: CorridorImportDepartmentId
): { name: string; slug: string; sort_priority: number; bbox: ParaguayDepartmentPreset['bbox'] } | null {
  const p = PARAGUAY_DEPARTMENT_PRESETS[departmentId];
  if (!p) return null;
  return {
    name: departmentMetroName(p),
    slug: departmentMetroSlug(departmentId),
    sort_priority: 18,
    bbox: p.bbox,
  };
}

type LatLng = { lat: number; lng: number };
export type CityPolygonRecord = { id: string; name: string; active: boolean; polygon_latlng: LatLng[] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function simplifyByStep(ring: LatLng[], maxPoints = 1200): LatLng[] {
  if (ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  const out: LatLng[] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  if (out.length < 3) return ring.slice(0, 3);
  return out;
}

function signedDistanceToLine(p: LatLng, a: LatLng, b: LatLng): number {
  return (b.lng - a.lng) * (p.lat - a.lat) - (b.lat - a.lat) * (p.lng - a.lng);
}

function intersectSegmentWithLine(s: LatLng, e: LatLng, a: LatLng, b: LatLng): LatLng {
  const ds = signedDistanceToLine(s, a, b);
  const de = signedDistanceToLine(e, a, b);
  const den = ds - de;
  if (Math.abs(den) < 1e-12) return { ...s };
  const t = ds / den;
  return {
    lat: s.lat + (e.lat - s.lat) * t,
    lng: s.lng + (e.lng - s.lng) * t,
  };
}

function clipPolygonByHalfPlane(ring: LatLng[], a: LatLng, b: LatLng, keepLeft: boolean): LatLng[] {
  if (ring.length < 3) return [];
  const out: LatLng[] = [];
  for (let i = 0; i < ring.length; i++) {
    const s = ring[i];
    const e = ring[(i + 1) % ring.length];
    const ds = signedDistanceToLine(s, a, b);
    const de = signedDistanceToLine(e, a, b);
    const inS = keepLeft ? ds >= 0 : ds <= 0;
    const inE = keepLeft ? de >= 0 : de <= 0;
    if (inS && inE) {
      out.push(e);
    } else if (inS && !inE) {
      out.push(intersectSegmentWithLine(s, e, a, b));
    } else if (!inS && inE) {
      out.push(intersectSegmentWithLine(s, e, a, b), e);
    }
  }
  return out.length >= 3 ? out : [];
}

function centroidLat(ring: LatLng[]): number {
  if (ring.length === 0) return -999;
  return ring.reduce((acc, p) => acc + p.lat, 0) / ring.length;
}

function splitAsuncionByMariscalLopez(ring: LatLng[]): { centro: LatLng[]; norte: LatLng[] } | null {
  const west: LatLng = { lat: -25.2898, lng: -57.6355 };
  const east: LatLng = { lat: -25.3122, lng: -57.5476 };
  const left = clipPolygonByHalfPlane(ring, west, east, true);
  const right = clipPolygonByHalfPlane(ring, west, east, false);
  if (left.length < 3 || right.length < 3) return null;
  const leftLat = centroidLat(left);
  const rightLat = centroidLat(right);
  if (leftLat >= rightLat) {
    return { norte: simplifyByStep(left), centro: simplifyByStep(right) };
  }
  return { norte: simplifyByStep(right), centro: simplifyByStep(left) };
}

function splitNorthSouthByMedianLat(ring: LatLng[]): { norte: LatLng[]; sur: LatLng[] } | null {
  if (ring.length < 3) return null;
  const lats = ring.map((p) => p.lat).sort((a, b) => a - b);
  const mid = lats[Math.floor(lats.length / 2)];
  const minLng = Math.min(...ring.map((p) => p.lng));
  const maxLng = Math.max(...ring.map((p) => p.lng));
  const west: LatLng = { lat: mid, lng: minLng - 0.15 };
  const east: LatLng = { lat: mid, lng: maxLng + 0.15 };
  const north = clipPolygonByHalfPlane(ring, west, east, true);
  const south = clipPolygonByHalfPlane(ring, west, east, false);
  if (north.length < 3 || south.length < 3) return null;
  return { norte: simplifyByStep(north), sur: simplifyByStep(south) };
}

async function fetchMariscalLopezLine(): Promise<{ west: LatLng; east: LatLng } | null> {
  const q = encodeURIComponent('Avenida Mariscal López, Asunción, Paraguay');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1&q=${q}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'xhare-admin-corridors/1.0', Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ geojson?: { type?: string; coordinates?: unknown } }>;
  const g = data?.[0]?.geojson;
  if (!g || typeof g.type !== 'string') return null;
  const coords = g.coordinates;
  if (g.type === 'LineString' && Array.isArray(coords) && coords.length >= 2) {
    const pts = (coords as unknown[])
      .map((v) => (Array.isArray(v) && v.length >= 2 ? { lng: Number(v[0]), lat: Number(v[1]) } : null))
      .filter((v): v is { lat: number; lng: number } => !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng));
    if (pts.length >= 2) {
      let west = pts[0];
      let east = pts[0];
      for (const p of pts) {
        if (p.lng < west.lng) west = p;
        if (p.lng > east.lng) east = p;
      }
      return { west, east };
    }
  }
  return null;
}

function bboxFromPolys(polys: LatLng[][]): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
  }
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

function toRing(geo: unknown): LatLng[] | null {
  if (!geo || typeof geo !== 'object') return null;
  const g = geo as { type?: unknown; coordinates?: unknown };
  const type = typeof g.type === 'string' ? g.type : '';
  const coords = g.coordinates;
  const parsePair = (v: unknown): LatLng | null => {
    if (!Array.isArray(v) || v.length < 2) return null;
    const lng = Number(v[0]);
    const lat = Number(v[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };
  if (type === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
    const ext = coords[0] as unknown[];
    const ring: LatLng[] = [];
    for (const p of ext) {
      const ll = parsePair(p);
      if (!ll) return null;
      ring.push(ll);
    }
    if (ring.length >= 2) {
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (a.lat === b.lat && a.lng === b.lng) ring.pop();
    }
    return ring.length >= 3 ? ring : null;
  }
  if (type === 'MultiPolygon' && Array.isArray(coords)) {
    let best: LatLng[] | null = null;
    for (const poly of coords as unknown[]) {
      if (!Array.isArray(poly) || !Array.isArray(poly[0])) continue;
      const ext = poly[0] as unknown[];
      const ring: LatLng[] = [];
      for (const p of ext) {
        const ll = parsePair(p);
        if (!ll) {
          ring.length = 0;
          break;
        }
        ring.push(ll);
      }
      if (ring.length >= 2) {
        const a = ring[0];
        const b = ring[ring.length - 1];
        if (a.lat === b.lat && a.lng === b.lng) ring.pop();
      }
      if (ring.length >= 3 && (!best || ring.length > best.length)) best = ring;
    }
    return best;
  }
  return null;
}

/** Consultas alternativas cuando Nominatim no resuelve el nombre habitual. */
const CITY_NOMINATIM_ALIASES: Record<string, string[]> = {
  Asunción: ['Asunción, Distrito Capital, Paraguay', 'Distrito Capital, Paraguay'],
  Repatriación: ['Colonia Repatriación, Caaguazú, Paraguay', 'Repatriacion, Caaguazú, Paraguay'],
  'Coronel Oviedo': ['Coronel Oviedo, Caaguazú Department, Paraguay'],
  Caaguazú: ['Caaguazú, Caaguazú Department, Paraguay', 'Caaguazu, Paraguay'],
};

const ASUNCION_BOUNDARY_QUERIES = [
  'Asunción, Distrito Capital, Paraguay',
  'Distrito Capital, Paraguay',
  'Asunción, Paraguay',
];

/** Nominatim suele devolver un Point en `limit=1`; buscamos el primer Polygon/MultiPolygon. */
async function fetchNominatimPolygonRing(query: string): Promise<LatLng[] | null> {
  const q = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=8&q=${q}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'xhare-admin-corridors/1.0', Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ geojson?: unknown }>;
  for (const item of data) {
    const ring = toRing(item?.geojson);
    if (ring) return simplifyByStep(ring);
  }
  return null;
}

async function fetchCityPolygon(city: string, nominatimDepartment: string): Promise<LatLng[] | null> {
  const queries = [
    `${city}, ${nominatimDepartment}, Paraguay`,
    ...(CITY_NOMINATIM_ALIASES[city] ?? []),
  ];
  for (const query of queries) {
    const ring = await fetchNominatimPolygonRing(query);
    if (ring) return ring;
    await sleep(350);
  }
  return null;
}

async function fetchAsuncionBoundaryRing(): Promise<LatLng[] | null> {
  for (const query of ASUNCION_BOUNDARY_QUERIES) {
    const ring = await fetchNominatimPolygonRing(query);
    if (ring) return ring;
    await sleep(350);
  }
  return null;
}

async function fetchAsuncionSplit(idPrefix: string): Promise<CityPolygonRecord[] | null> {
  const asu = await fetchAsuncionBoundaryRing();
  if (!asu) return null;
  const road = await fetchMariscalLopezLine();
  let split: { centro: LatLng[]; norte: LatLng[] } | null = null;
  if (road) {
    const sideA = clipPolygonByHalfPlane(asu, road.west, road.east, true);
    const sideB = clipPolygonByHalfPlane(asu, road.west, road.east, false);
    if (sideA.length >= 3 && sideB.length >= 3) {
      const aLat = centroidLat(sideA);
      const bLat = centroidLat(sideB);
      split =
        aLat >= bLat
          ? { norte: simplifyByStep(sideA), centro: simplifyByStep(sideB) }
          : { norte: simplifyByStep(sideB), centro: simplifyByStep(sideA) };
    }
  }
  if (!split) split = splitAsuncionByMariscalLopez(asu);
  if (!split) return null;
  return [
    {
      id: `${idPrefix}-asuncion-centro`,
      name: 'Asuncion Centro',
      active: true,
      polygon_latlng: split.centro,
    },
    {
      id: `${idPrefix}-asuncion-norte`,
      name: 'Asuncion Norte',
      active: true,
      polygon_latlng: split.norte,
    },
  ];
}

export async function collectDepartmentCityPolygons(
  department: CorridorImportDepartmentId
): Promise<{ imported: CityPolygonRecord[]; missing: string[] }> {
  const preset = PARAGUAY_DEPARTMENT_PRESETS[department];
  const imported: CityPolygonRecord[] = [];
  const missing: string[] = [];
  const splitNs = new Set(preset.splitNorthSouth ?? []);

  if (preset.importAsuncionSplit) {
    try {
      const asu = await fetchAsuncionSplit(preset.idPrefix);
      if (asu && asu.length >= 2) {
        imported.push(...asu);
      } else {
        missing.push('Asuncion (split Centro/Norte)');
        const fallbackRing = await fetchAsuncionBoundaryRing();
        if (fallbackRing) {
          imported.push({
            id: `${preset.idPrefix}-asuncion`,
            name: 'Asunción',
            active: true,
            polygon_latlng: fallbackRing,
          });
        }
      }
    } catch {
      missing.push('Asuncion (split Centro/Norte)');
      const fallbackRing = await fetchAsuncionBoundaryRing();
      if (fallbackRing) {
        imported.push({
          id: `${preset.idPrefix}-asuncion`,
          name: 'Asunción',
          active: true,
          polygon_latlng: fallbackRing,
        });
      }
    }
    await sleep(350);
  }

  for (const city of preset.cities) {
    if (preset.importAsuncionSplit && city === 'Asunción') continue;
    try {
      const ring = await fetchCityPolygon(city, preset.nominatimDepartment);
      if (!ring) {
        missing.push(city);
        continue;
      }
      if (splitNs.has(city)) {
        const split = splitNorthSouthByMedianLat(ring);
        if (split) {
          imported.push({
            id: `${preset.idPrefix}-${slugify(city)}-norte`,
            name: `${city} Norte`,
            active: true,
            polygon_latlng: split.norte,
          });
          imported.push({
            id: `${preset.idPrefix}-${slugify(city)}-sur`,
            name: `${city} Sur`,
            active: true,
            polygon_latlng: split.sur,
          });
          continue;
        }
      }
      imported.push({
        id: `${preset.idPrefix}-${slugify(city)}`,
        name: city,
        active: true,
        polygon_latlng: ring,
      });
    } catch {
      missing.push(city);
    }
  }

  return { imported, missing };
}

export type ImportCorridorCitiesResult =
  | { ok: true; corridor: Record<string, unknown>; imported: number; missing: string[]; department: CorridorImportDepartmentId }
  | { ok: false; status: number; error: string; missing?: string[] };

export async function importCorridorDepartmentCities(
  svc: SupabaseClient,
  corridorId: string,
  kind: 'origin' | 'destination',
  department: CorridorImportDepartmentId
): Promise<ImportCorridorCitiesResult> {
  const preset = PARAGUAY_DEPARTMENT_PRESETS[department];
  const { data: row, error: fetchErr } = await svc
    .from('corridors')
    .select('id, origin_zone, destination_zone')
    .eq('id', corridorId)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, status: 400, error: 'No se pudo leer la zona solicitada.' };
  }
  if (!row) {
    return { ok: false, status: 404, error: 'Zona no encontrada' };
  }

  const { imported, missing } = await collectDepartmentCityPolygons(department);
  if (imported.length === 0) {
    const detail =
      missing.length > 0 ? ` (${missing.join('; ')})` : '';
    return {
      ok: false,
      status: 502,
      error: `No se pudo importar ninguna ciudad de ${preset.label}${detail}. OpenStreetMap no devolvió polígonos; probá de nuevo en unos minutos.`,
      missing,
    };
  }

  const bbox = bboxFromPolys(imported.map((c) => c.polygon_latlng));
  if (!bbox) {
    return { ok: false, status: 500, error: 'No se pudo calcular bbox' };
  }

  const current = (kind === 'origin' ? row.origin_zone : row.destination_zone) as Record<string, unknown>;
  const nextZone: Record<string, unknown> = {
    ...current,
    minLat: bbox.minLat,
    maxLat: bbox.maxLat,
    minLng: bbox.minLng,
    maxLng: bbox.maxLng,
    city_polygons: imported,
  };

  const patch = kind === 'origin' ? { origin_zone: nextZone } : { destination_zone: nextZone };
  const { data: updated, error: upErr } = await svc
    .from('corridors')
    .update(patch)
    .eq('id', corridorId)
    .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active, created_at')
    .single();

  if (upErr) {
    return { ok: false, status: 400, error: 'No se pudo guardar la importación de ciudades en la zona.' };
  }

  return {
    ok: true,
    corridor: updated as Record<string, unknown>,
    imported: imported.length,
    missing,
    department,
  };
}

export function emptyZoneFromBbox(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Record<string, unknown> {
  return {
    minLat: bbox.minLat,
    maxLat: bbox.maxLat,
    minLng: bbox.minLng,
    maxLng: bbox.maxLng,
    city_polygons: [],
  };
}
