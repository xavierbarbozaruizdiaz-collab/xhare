import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-import-central';
const ADMIN_IMPORT_CENTRAL_WINDOW_MS = 60_000;
const ADMIN_IMPORT_CENTRAL_MAX_PER_WINDOW = 10;

const CENTRAL_CITIES = [
  'Lambare',
  'Fernando de la Mora',
  'San Lorenzo',
  'Luque',
  'Mariano Roque Alonso',
  'Limpio',
  'Nemby',
  'Villa Elisa',
  'Capiata',
  'Itaugua',
  'Ypane',
  'Guarambare',
  'Ita',
  'Aregua',
  'Nueva Italia',
  'Villeta',
  'J. Augusto Saldivar',
  'San Antonio',
] as const;
const SPLIT_NORTH_SOUTH = new Set([
  'Luque',
  'Limpio',
  'Aregua',
  'Capiata',
  'Itaugua',
  'Ita',
  'Villeta',
  'Nueva Italia',
]);

type LatLng = { lat: number; lng: number };
type CityPolygonRecord = { id: string; name: string; active: boolean; polygon_latlng: LatLng[] };

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
  // Fallback: usa línea E-W aproximada si no se puede obtener la traza vial real.
  const west: LatLng = { lat: -25.2898, lng: -57.6355 };
  const east: LatLng = { lat: -25.3122, lng: -57.5476 };
  const left = clipPolygonByHalfPlane(ring, west, east, true);
  const right = clipPolygonByHalfPlane(ring, west, east, false);
  if (left.length < 3 || right.length < 3) return null;
  // La parte más al norte (lat mayor) la etiquetamos como "Asunción Norte".
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
    headers: {
      'User-Agent': 'xhare-admin-corridors/1.0',
      Accept: 'application/json',
    },
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

async function fetchCityPolygon(city: string): Promise<LatLng[] | null> {
  const q = encodeURIComponent(`${city}, Central, Paraguay`);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1&q=${q}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'xhare-admin-corridors/1.0',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ geojson?: unknown }>;
  const ring = toRing(data?.[0]?.geojson);
  return ring ? simplifyByStep(ring) : null;
}

async function fetchAsuncionSplit(): Promise<CityPolygonRecord[] | null> {
  const q = encodeURIComponent('Asunción, Paraguay');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1&q=${q}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'xhare-admin-corridors/1.0',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ geojson?: unknown }>;
  const asu = toRing(data?.[0]?.geojson);
  if (!asu) return null;
  const road = await fetchMariscalLopezLine();
  let split: { centro: LatLng[]; norte: LatLng[] } | null = null;
  if (road) {
    const sideA = clipPolygonByHalfPlane(asu, road.west, road.east, true);
    const sideB = clipPolygonByHalfPlane(asu, road.west, road.east, false);
    if (sideA.length >= 3 && sideB.length >= 3) {
      const aLat = centroidLat(sideA);
      const bLat = centroidLat(sideB);
      split = aLat >= bLat
        ? { norte: simplifyByStep(sideA), centro: simplifyByStep(sideB) }
        : { norte: simplifyByStep(sideB), centro: simplifyByStep(sideA) };
    }
  }
  if (!split) split = splitAsuncionByMariscalLopez(asu);
  if (!split) return null;
  return [
    {
      id: 'central-asuncion-centro',
      name: 'Asuncion Centro',
      active: true,
      polygon_latlng: split.centro,
    },
    {
      id: 'central-asuncion-norte',
      name: 'Asuncion Norte',
      active: true,
      polygon_latlng: split.norte,
    },
  ];
}

/**
 * POST /api/admin/corridors/:id/import-central
 * Body: { kind: 'origin' | 'destination' }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withAdminAuth(request, async (_req, user) => {
    const id = params.id?.trim();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    const kind = (raw as { kind?: unknown })?.kind;
    if (kind !== 'origin' && kind !== 'destination') {
      return NextResponse.json({ error: 'kind debe ser origin o destination' }, { status: 400 });
    }

    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors-import-central:${clientId}`, ADMIN_IMPORT_CENTRAL_WINDOW_MS, ADMIN_IMPORT_CENTRAL_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
      const svc = createServiceClient();
      const { data: row, error: fetchErr } = await svc
        .from('corridors')
        .select('id, origin_zone, destination_zone')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) {
        logBlockError(BLOCK, fetchErr.message, fetchErr);
        return NextResponse.json({ error: 'No se pudo leer el corredor solicitado.' }, { status: 400 });
      }
      if (!row) return NextResponse.json({ error: 'Corredor no encontrado' }, { status: 404 });

      const imported: CityPolygonRecord[] = [];
      const missing: string[] = [];
      try {
        const asu = await fetchAsuncionSplit();
        if (asu && asu.length === 2) {
          imported.push(...asu);
        } else {
          missing.push('Asuncion (split Centro/Norte)');
        }
      } catch {
        missing.push('Asuncion (split Centro/Norte)');
      }
      for (const city of CENTRAL_CITIES) {
        try {
          const ring = await fetchCityPolygon(city);
          if (!ring) {
            missing.push(city);
            continue;
          }
          if (SPLIT_NORTH_SOUTH.has(city)) {
            const split = splitNorthSouthByMedianLat(ring);
            if (split) {
              imported.push({
                id: `central-${slugify(city)}-norte`,
                name: `${city} Norte`,
                active: true,
                polygon_latlng: split.norte,
              });
              imported.push({
                id: `central-${slugify(city)}-sur`,
                name: `${city} Sur`,
                active: true,
                polygon_latlng: split.sur,
              });
              continue;
            }
          }
          imported.push({
            id: `central-${slugify(city)}`,
            name: city,
            active: true,
            polygon_latlng: ring,
          });
        } catch {
          missing.push(city);
        }
      }
      if (imported.length === 0) {
        return NextResponse.json({ error: 'No se pudo importar ninguna ciudad de Central' }, { status: 502 });
      }
      const bbox = bboxFromPolys(imported.map((c) => c.polygon_latlng));
      if (!bbox) return NextResponse.json({ error: 'No se pudo calcular bbox' }, { status: 500 });

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
        .eq('id', id)
        .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active, created_at')
        .single();
      if (upErr) {
        logBlockError(BLOCK, upErr.message, upErr);
        return NextResponse.json({ error: 'No se pudo guardar la importación de ciudades en el corredor.' }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ corridor: updated, imported: imported.length, missing });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

