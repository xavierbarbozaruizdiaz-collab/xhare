import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';

const polyPoint = z.object({ lat: z.number(), lng: z.number() });

/**
 * Cuerpo alineado a `trip_requests` (sin user_id: lo toma del JWT).
 * La app móvil usa esta ruta cuando EXPO_PUBLIC_API_BASE_URL apunta al Next local,
 * evitando inserts directos a Supabase que en emulador/red a veces no completan.
 */
const insertBodySchema = z.object({
  origin_lat: z.number(),
  origin_lng: z.number(),
  origin_label: z.string().max(500),
  destination_lat: z.number(),
  destination_lng: z.number(),
  destination_label: z.string().max(500),
  requested_date: z.string().min(8),
  requested_time: z.string().min(4),
  seats: z.number().int().min(1).max(50).optional(),
  pricing_kind: z.enum(['internal', 'long_distance']),
  origin_city: z.string().nullable().optional(),
  origin_department: z.string().nullable().optional(),
  origin_barrio: z.string().nullable().optional(),
  destination_city: z.string().nullable().optional(),
  destination_department: z.string().nullable().optional(),
  destination_barrio: z.string().nullable().optional(),
  route_polyline: z.array(polyPoint).optional(),
  route_length_km: z.number().nullable().optional(),
  passenger_desired_price_per_seat_gs: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return v;
      if (typeof v === 'string') {
        const n = parseInt(String(v).replace(/\D/g, ''), 10);
        return Number.isFinite(n) ? n : v;
      }
      return v;
    },
    z.number().int().positive().max(10_000_000_000).nullable().optional()
  ),
  internal_quote_acknowledged: z.boolean().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuth(request);
    if (auth instanceof NextResponse) return auth;

    const raw = await request.json();
    const parsed = insertBodySchema.safeParse(raw);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      let hint = '';
      for (const [key, msgs] of Object.entries(flat.fieldErrors)) {
        if (msgs && msgs[0]) {
          hint = `${key}: ${msgs[0]}`;
          break;
        }
      }
      if (!hint && flat.formErrors[0]) hint = flat.formErrors[0];
      return NextResponse.json(
        { error: hint || 'Datos inválidos', details: flat },
        { status: 400 }
      );
    }

    const p = parsed.data;
    const kind = p.pricing_kind;
    if (
      kind === 'long_distance' &&
      (p.passenger_desired_price_per_seat_gs == null ||
        !Number.isFinite(p.passenger_desired_price_per_seat_gs) ||
        p.passenger_desired_price_per_seat_gs < 1)
    ) {
      return NextResponse.json(
        { error: 'Larga distancia: indicá precio por asiento (guaraníes).' },
        { status: 400 }
      );
    }
    const row: Record<string, unknown> = {
      user_id: auth.user.id,
      origin_lat: p.origin_lat,
      origin_lng: p.origin_lng,
      origin_label: p.origin_label,
      destination_lat: p.destination_lat,
      destination_lng: p.destination_lng,
      destination_label: p.destination_label,
      requested_date: p.requested_date,
      requested_time: p.requested_time,
      seats: p.seats ?? 1,
      status: 'pending',
      pricing_kind: kind,
    };

    if (p.origin_city != null) row.origin_city = p.origin_city;
    if (p.origin_department != null) row.origin_department = p.origin_department;
    if (p.origin_barrio != null) row.origin_barrio = p.origin_barrio;
    if (p.destination_city != null) row.destination_city = p.destination_city;
    if (p.destination_department != null) row.destination_department = p.destination_department;
    if (p.destination_barrio != null) row.destination_barrio = p.destination_barrio;
    if (p.route_polyline != null && p.route_polyline.length > 0) row.route_polyline = p.route_polyline;
    if (p.route_length_km != null) row.route_length_km = p.route_length_km;

    if (kind === 'long_distance' && p.passenger_desired_price_per_seat_gs != null) {
      row.passenger_desired_price_per_seat_gs = Math.round(p.passenger_desired_price_per_seat_gs);
      row.internal_quote_acknowledged = null;
    } else {
      row.passenger_desired_price_per_seat_gs = null;
      row.internal_quote_acknowledged = p.internal_quote_acknowledged === true ? true : null;
    }

    const { error } = await auth.supabase.from('trip_requests').insert(row);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
