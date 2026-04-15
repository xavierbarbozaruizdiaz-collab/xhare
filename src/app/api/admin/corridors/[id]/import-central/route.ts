import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-import-central';

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
];

type LatLng = { lat: number; lng: number };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function simplifyByStep(ring: LatLng[], maxPoints = 220): LatLng[] {
  if (ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  const out: LatLng[] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  if (out.length < 3) return ring.slice(0, 3);
  return out;
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

/**
 * POST /api/admin/corridors/:id/import-central
 * Body: { kind: 'origin' | 'destination' }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withAdminAuth(request, async () => {
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
      const svc = createServiceClient();
      const { data: row, error: fetchErr } = await svc
        .from('corridors')
        .select('id, origin_zone, destination_zone')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 400 });
      if (!row) return NextResponse.json({ error: 'Corredor no encontrado' }, { status: 404 });

      const imported: Array<{ id: string; name: string; active: boolean; polygon_latlng: LatLng[] }> = [];
      const missing: string[] = [];
      for (const city of CENTRAL_CITIES) {
        try {
          const ring = await fetchCityPolygon(city);
          if (!ring) {
            missing.push(city);
            continue;
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
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

      logBlockOk(BLOCK);
      return NextResponse.json({ corridor: updated, imported: imported.length, missing });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

