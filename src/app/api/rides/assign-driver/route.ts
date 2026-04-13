import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDriver } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';

const bodySchema = z.object({
  ride_id: z.string().uuid(),
});

/**
 * POST /api/rides/assign-driver
 * Conductor autenticado toma un ride en awaiting_driver → driver_id + published.
 * Service role para evitar RLS (antes del claim, driver_id es NULL).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireDriver(request);
    if (auth instanceof NextResponse) return auth;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body: { "ride_id": "<uuid>" }', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const rideId = parsed.data.ride_id;
    const svc = createServiceClient();

    const { data: existing, error: fetchErr } = await svc
      .from('rides')
      .select('id, status, driver_id')
      .eq('id', rideId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 });
    }
    if (String(existing.status) !== 'awaiting_driver') {
      return NextResponse.json(
        { error: 'Este viaje no está disponible para tomar (no está en awaiting_driver).' },
        { status: 400 }
      );
    }
    if (existing.driver_id != null) {
      return NextResponse.json({ error: 'El viaje ya tiene conductor asignado.' }, { status: 400 });
    }

    const { data: updated, error: upErr } = await svc
      .from('rides')
      .update({
        driver_id: auth.user.id,
        status: 'published',
        updated_at: new Date().toISOString(),
      })
      .eq('id', rideId)
      .eq('status', 'awaiting_driver')
      .is('driver_id', null)
      .select()
      .maybeSingle();

    if (upErr) {
      console.error('[assign-driver] update:', upErr.message);
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'No se pudo asignar: otro conductor lo tomó o el estado cambió.' },
        { status: 409 }
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      console.info('[assign-driver] ok', { rideId, driverId: auth.user.id });
    }

    return NextResponse.json({ ok: true, ride_id: updated.id, ride: updated });
  } catch (e) {
    console.error('[assign-driver]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
