import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';
import { classificationLogFromRow } from '@/lib/trip-request-classification';

const polyPoint = z.object({ lat: z.number(), lng: z.number() });

/**
 * Cuerpo alineado a `trip_requests` (sin user_id: lo toma del JWT).
 * La app móvil usa esta ruta cuando EXPO_PUBLIC_API_BASE_URL apunta al Next local,
 * evitando inserts directos a Supabase que en emulador/red a veces no completan.
 */
const insertBodySchema = z
  .object({
    origin_lat: z.number(),
    origin_lng: z.number(),
    origin_label: z.string().max(500),
    destination_lat: z.number(),
    destination_lng: z.number(),
    destination_label: z.string().max(500),
    requested_date: z.string().min(8),
    requested_time: z.string().min(4),
    requested_mode: z.enum(['now', 'scheduled']).optional(),
    requested_time_start: z.string().min(10).optional(),
    requested_time_end: z.string().min(10).optional(),
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
  })
  .superRefine((data, ctx) => {
    const olat = data.origin_lat;
    const olng = data.origin_lng;
    const dlat = data.destination_lat;
    const dlng = data.destination_lng;
    if (
      ![olat, olng, dlat, dlng].every(
        (n) => typeof n === 'number' && Number.isFinite(n)
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Coordenadas inválidas',
        path: ['origin_lat'],
      });
    }
    if (olat === dlat && olng === dlng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Origen y destino no pueden ser el mismo punto.',
        path: ['destination_lat'],
      });
    }
    const hasStart = data.requested_time_start != null && data.requested_time_start.trim() !== '';
    const hasEnd = data.requested_time_end != null && data.requested_time_end.trim() !== '';
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enviá requested_time_start y requested_time_end juntos, o ninguno.',
        path: ['requested_time_start'],
      });
    }
    if (hasStart && hasEnd) {
      const a = Date.parse(String(data.requested_time_start));
      const b = Date.parse(String(data.requested_time_end));
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Ventana horaria: usá fechas ISO válidas.',
          path: ['requested_time_start'],
        });
      } else if (b < a) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'La hora de fin debe ser posterior o igual al inicio.',
          path: ['requested_time_end'],
        });
      }
    }
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
      requested_mode: p.requested_mode ?? 'scheduled',
      seats: p.seats ?? 1,
      status: 'pending',
      pricing_kind: kind,
    };

    const ts = p.requested_time_start?.trim();
    const te = p.requested_time_end?.trim();
    if (ts && te) {
      row.requested_time_start = ts;
      row.requested_time_end = te;
    }

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

    const { data: inserted, error } = await auth.supabase
      .from('trip_requests')
      .insert(row)
      .select(
        'id, requested_mode, requested_time_start, requested_time_end, seats, corridor_id, time_bucket, classification_status, origin_node_key, destination_node_key'
      )
      .single();

    if (error) {
      console.error('[api/trip-requests] insert failed', {
        userId: auth.user.id,
        message: error.message,
        code: error.code,
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.info('[api/trip-requests] insert ok', {
      userId: auth.user.id,
      tripRequestId: inserted?.id,
      requested_mode: inserted?.requested_mode,
      requested_time_start: inserted?.requested_time_start,
      requested_time_end: inserted?.requested_time_end,
      seats: inserted?.seats,
    });

    const logClassification =
      process.env.NODE_ENV !== 'production' || process.env.CLASSIFICATION_LOG === '1';
    if (logClassification && inserted?.id) {
      console.info('[classification]', classificationLogFromRow(inserted as Record<string, unknown>));
    }

    return NextResponse.json({ ok: true, id: inserted?.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
