import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-patch';

const zoneSchema = z.object({
  minLat: z.number().finite(),
  maxLat: z.number().finite(),
  minLng: z.number().finite(),
  maxLng: z.number().finite(),
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

function zoneToJson(box: z.infer<typeof zoneSchema>): Record<string, number> {
  return {
    minLat: box.minLat,
    maxLat: box.maxLat,
    minLng: box.minLng,
    maxLng: box.maxLng,
  };
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

      const nextOrigin = parsed.data.origin_zone
        ? zoneToJson(parsed.data.origin_zone)
        : (row.origin_zone as Record<string, number>);
      const nextDest = parsed.data.destination_zone
        ? zoneToJson(parsed.data.destination_zone)
        : (row.destination_zone as Record<string, number>);

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
