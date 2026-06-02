import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import type { RideStopForBookingLink } from '@/lib/booking-stop-link';
import {
  dropoffDone,
  isBoarded,
  nearestPublishedStopOrder,
} from '@/lib/ride-arrive-visit';

const bodySchema = z.object({
  bookingId: z.string().uuid(),
  access_token: z.string().optional(),
});

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const service = createServiceClient();
    const rideId = params.id;

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'bookingId requerido' }, { status: 400 });
    }
    const { bookingId, access_token: tokenFromBody } = parsed.data;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const tokenFromHeader = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const tokenCandidates = [tokenFromHeader, String(tokenFromBody ?? '').trim()].filter(Boolean);

    if (tokenCandidates.length === 0) {
      return NextResponse.json({ error: 'Sesión expirada o no válida.' }, { status: 401 });
    }

    let userId = '';
    let authenticated = false;
    for (const token of tokenCandidates) {
      const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error: authError,
      } = await jwtClient.auth.getUser();
      if (!authError && user?.id) {
        userId = String(user.id);
        authenticated = true;
        break;
      }
    }
    if (!authenticated || !userId) {
      return NextResponse.json({ error: 'Sesión expirada o no válida.' }, { status: 401 });
    }

    const clientId = getClientId(request, userId);
    if (!checkRateLimit(`dropoff-passenger:${clientId}`, WINDOW_MS, MAX_PER_WINDOW)) {
      return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
    }

    const { data: ride } = await service
      .from('rides')
      .select('id, driver_id, status')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== userId) {
      return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        { error: 'Solo podés registrar bajadas cuando el viaje está en curso' },
        { status: 400 }
      );
    }

    const { data: booking } = await service
      .from('bookings')
      .select('id, status, dropoff_lat, dropoff_lng')
      .eq('id', bookingId)
      .eq('ride_id', rideId)
      .maybeSingle();

    if (!booking || booking.status === 'cancelled') {
      return NextResponse.json({ error: 'Reserva no encontrada en este viaje' }, { status: 404 });
    }

    const { data: existingEventsRaw } = await service
      .from('ride_boarding_events')
      .select('booking_id, event_type')
      .eq('ride_id', rideId);

    const existingEvents = (existingEventsRaw ?? []).map((e: { booking_id: unknown; event_type: unknown }) => ({
      booking_id: String(e.booking_id),
      event_type: String(e.event_type),
    }));

    if (!isBoarded(existingEvents, bookingId)) {
      return NextResponse.json(
        { error: 'Ese pasajero aún no figura como subido en este viaje' },
        { status: 400 }
      );
    }
    if (dropoffDone(existingEvents, bookingId)) {
      return NextResponse.json({ error: 'Ese pasajero ya figura como bajado' }, { status: 400 });
    }

    const { data: stops } = await service
      .from('ride_stops')
      .select('id, stop_order, lat, lng, is_base_stop')
      .eq('ride_id', rideId)
      .order('stop_order', { ascending: true });

    const linkStops: Array<RideStopForBookingLink & { stop_order: number; is_base_stop?: boolean | null }> =
      (stops ?? [])
        .filter((s: { id: unknown }) => s.id != null)
        .map((s: { id: unknown; lat: unknown; lng: unknown; stop_order: unknown; is_base_stop?: unknown }) => ({
          id: String(s.id),
          lat: Number(s.lat),
          lng: Number(s.lng),
          stop_order: Number(s.stop_order),
          is_base_stop: s.is_base_stop === true ? true : s.is_base_stop === false ? false : null,
        }))
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.stop_order));

    const lat = Number(booking.dropoff_lat);
    const lng = Number(booking.dropoff_lng);
    const stopIndex =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? (nearestPublishedStopOrder(linkStops, lat, lng) ?? 0)
        : 0;

    const { error: insertErr } = await service.from('ride_boarding_events').insert({
      ride_id: rideId,
      booking_id: bookingId,
      stop_index: stopIndex,
      event_type: 'dropped_off',
    });

    if (insertErr) {
      if (insertErr.code === '23505') {
        return NextResponse.json({ error: 'Ese pasajero ya figura como bajado' }, { status: 400 });
      }
      console.error('[dropoff-passenger] insert error:', insertErr.message);
      return NextResponse.json({ error: 'No se pudo registrar la bajada' }, { status: 500 });
    }

    return NextResponse.json({ success: true, bookingId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error('[dropoff-passenger] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
