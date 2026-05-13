import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Cron diario: cancela reservas (pending/confirmed) en viajes que nunca arrancaron
 * (`published` / `booked`) y cuya `departure_time` ya pasó.
 * Libera cupos vía trigger `update_ride_available_seats` al pasar booking a `cancelled`.
 *
 * Complementa `driver-no-show-sanctions` (que exige `driver_id` y marca no-show al conductor):
 * acá cubrimos el cierre de reservas “colgadas” en viajes aún publicados/reservados con salida vencida.
 *
 * GET con Authorization: Bearer CRON_SECRET (igual que otros crons).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    if (auth.trim() !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  const service = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: rides, error: ridesErr } = await service
    .from('rides')
    .select('id')
    .lt('departure_time', nowIso)
    .in('status', ['published', 'booked'])
    .limit(500);

  if (ridesErr) {
    console.error('[cron/passenger-stale-bookings] rides', ridesErr.message);
    return NextResponse.json({ error: ridesErr.message }, { status: 500 });
  }

  const rideIds = (rides ?? [])
    .map((r) => String((r as { id?: unknown }).id ?? '').trim())
    .filter(Boolean);
  if (rideIds.length === 0) {
    return NextResponse.json({ ok: true, cancelledBookings: 0, rideCandidates: 0 });
  }

  const { data: updated, error: upErr } = await service
    .from('bookings')
    .update({ status: 'cancelled', updated_at: nowIso })
    .in('ride_id', rideIds)
    .in('status', ['pending', 'confirmed'])
    .select('id');

  if (upErr) {
    console.error('[cron/passenger-stale-bookings] bookings', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const cancelledBookings = (updated ?? []).length;
  return NextResponse.json({
    ok: true,
    cancelledBookings,
    rideCandidates: rideIds.length,
  });
}
