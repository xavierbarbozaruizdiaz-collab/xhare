import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'dispatch-route-snapshot';

const MAX_POLYLINE_POINTS = 50_000;
const MAX_STOPS = 200;

function isValidDateYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00`));
}

function sanitizePolyline(raw: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ lat: number; lng: number }> = [];
  for (const p of raw.slice(0, MAX_POLYLINE_POINTS)) {
    if (!p || typeof p !== 'object') return null;
    const lat = (p as { lat?: unknown }).lat;
    const lng = (p as { lng?: unknown }).lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    out.push({ lat, lng });
  }
  return out.length >= 2 ? out : null;
}

function sanitizeStops(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_STOPS) return null;
  const out: unknown[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    const markerId = o.markerId;
    const lat = o.lat;
    const lng = o.lng;
    if (typeof markerId !== 'string' || markerId.length > 512) return null;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    out.push({
      markerId,
      order: typeof o.order === 'number' && Number.isFinite(o.order) ? Math.floor(o.order) : null,
      lat,
      lng,
      label: typeof o.label === 'string' ? o.label.slice(0, 2000) : null,
      placeName: typeof o.placeName === 'string' ? o.placeName.slice(0, 500) : o.placeName === null ? null : undefined,
      clientTimeHm:
        typeof o.clientTimeHm === 'string' ? o.clientTimeHm.slice(0, 16) : o.clientTimeHm === null ? null : undefined,
      recalculatedHm:
        typeof o.recalculatedHm === 'string'
          ? o.recalculatedHm.slice(0, 16)
          : o.recalculatedHm === null
            ? null
            : undefined,
    });
  }
  return out;
}

/**
 * POST /api/admin/dispatch-route-snapshot
 * Persiste polilínea + paradas del mapa de despacho (auditoría / futuro consumo por app).
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const polyline = sanitizePolyline(b.polyline);
    const stops = sanitizeStops(b.stops);
    if (!polyline || !stops) {
      return NextResponse.json(
        { error: 'polyline (≥2 puntos {lat,lng}) y stops (1–200, con markerId) son obligatorios' },
        { status: 400 }
      );
    }

    const dmRaw = b.durationMinutes;
    const durationMinutes =
      typeof dmRaw === 'number' && Number.isFinite(dmRaw) && dmRaw >= 0 ? Math.min(24 * 60, Math.floor(dmRaw)) : null;

    let mapDateFrom: string | null = null;
    let mapDateTo: string | null = null;
    if (typeof b.mapDateFrom === 'string' && isValidDateYmd(b.mapDateFrom)) mapDateFrom = b.mapDateFrom;
    if (typeof b.mapDateTo === 'string' && isValidDateYmd(b.mapDateTo)) mapDateTo = b.mapDateTo;

    try {
      const service = createServiceClient();
      const { data, error } = await service
        .from('admin_dispatch_route_snapshots')
        .insert({
          created_by: user.id,
          map_date_from: mapDateFrom,
          map_date_to: mapDateTo,
          duration_minutes: durationMinutes,
          polyline,
          stops,
          source: 'dispatch_map',
        })
        .select('id')
        .single();

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      logBlockOk(BLOCK);
      return NextResponse.json({ ok: true, id: data?.id as string });
    } catch (e) {
      logBlockError(BLOCK, 'insert_failed', e);
      return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
    }
  });
}
