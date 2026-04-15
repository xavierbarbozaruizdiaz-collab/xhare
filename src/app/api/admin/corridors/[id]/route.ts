import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-patch';

const hexPointSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
});
const cityPolygonSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  active: z.boolean().optional(),
  polygon_latlng: z.array(hexPointSchema).min(3).max(512),
});

const zoneSchema = z.object({
  minLat: z.number().finite(),
  maxLat: z.number().finite(),
  minLng: z.number().finite(),
  maxLng: z.number().finite(),
  /** Si viene, la clasificación usa PostGIS `ST_Covers` sobre el polígono (6 vértices). */
  hex_latlng: z.array(hexPointSchema).length(6).optional(),
  /** Si viene, tiene prioridad para clasificar (polígono contenedor libre). */
  polygon_latlng: z.array(hexPointSchema).min(3).max(256).optional(),
  /** Lista de ciudades (ej. Central) activables/desactivables por zona. */
  city_polygons: z.array(cityPolygonSchema).max(128).optional(),
});

const bodySchema = z
  .object({
    origin_zone: zoneSchema.optional(),
    destination_zone: zoneSchema.optional(),
  })
  .refine((b) => b.origin_zone != null || b.destination_zone != null, {
    message: 'Enviá al menos origin_zone o destination_zone',
  });

/** Límites amplios Paraguay / región (evita errores groseros). */
function assertZoneReasonable(box: z.infer<typeof zoneSchema>): string | null {
  const { minLat, maxLat, minLng, maxLng } = box;
  if (minLat > maxLat || minLng > maxLng) return 'Cada zona requiere minLat ≤ maxLat y minLng ≤ maxLng';
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  if (latSpan < 0.005 || lngSpan < 0.005) return 'La caja es demasiado chica (mín. ~0,5 km)';
  if (latSpan > 3 || lngSpan > 3) return 'La caja es demasiado grande';
  if (minLat < -28 || maxLat > -23 || minLng < -63 || maxLng > -52) return 'Coordenadas fuera del rango permitido para esta operación';
  return null;
}

function zoneToJson(box: z.infer<typeof zoneSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    minLat: box.minLat,
    maxLat: box.maxLat,
    minLng: box.minLng,
    maxLng: box.maxLng,
  };
  if (box.hex_latlng && box.hex_latlng.length === 6) {
    out.hex_latlng = box.hex_latlng.map((p) => ({ lat: p.lat, lng: p.lng }));
  }
  if (box.polygon_latlng && box.polygon_latlng.length >= 3) {
    out.polygon_latlng = box.polygon_latlng.map((p) => ({ lat: p.lat, lng: p.lng }));
  }
  if (box.city_polygons && box.city_polygons.length > 0) {
    out.city_polygons = box.city_polygons.map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active !== false,
      polygon_latlng: c.polygon_latlng.map((p) => ({ lat: p.lat, lng: p.lng })),
    }));
  }
  return out;
}

/**
 * PATCH /api/admin/corridors/:id
 * Actualiza origin_zone y/o destination_zone (bbox JSON).
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().formErrors[0] ?? 'Datos inválidos' },
        { status: 400 }
      );
    }

    if (parsed.data.origin_zone) {
      const err = assertZoneReasonable(parsed.data.origin_zone);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    if (parsed.data.destination_zone) {
      const err = assertZoneReasonable(parsed.data.destination_zone);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    try {
      const svc = createServiceClient();
      const { data: row, error: fetchErr } = await svc
        .from('corridors')
        .select('id, origin_zone, destination_zone')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) {
        logBlockError(BLOCK, fetchErr.message, fetchErr);
        return NextResponse.json({ error: fetchErr.message }, { status: 400 });
      }
      if (!row) {
        return NextResponse.json({ error: 'Corredor no encontrado' }, { status: 404 });
      }

      const prevO = row.origin_zone as Record<string, unknown>;
      const prevD = row.destination_zone as Record<string, unknown>;
      const nextOrigin = parsed.data.origin_zone ? zoneToJson(parsed.data.origin_zone) : prevO;
      const nextDest = parsed.data.destination_zone ? zoneToJson(parsed.data.destination_zone) : prevD;

      const { data: updated, error: upErr } = await svc
        .from('corridors')
        .update({
          origin_zone: nextOrigin,
          destination_zone: nextDest,
        })
        .eq('id', id)
        .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active, created_at')
        .single();

      if (upErr) {
        logBlockError(BLOCK, upErr.message, upErr);
        return NextResponse.json({ error: upErr.message }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ corridor: updated });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
