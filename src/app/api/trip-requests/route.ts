import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';
import { tripRequestSuperHexPair } from '@/lib/trip-request-h3';
import { classificationLogFromRow } from '@/lib/trip-request-classification';
import { insertOrUpdatePendingTripRequestFromFavorite } from '@/lib/trip-request-favorite-pending-upsert';
import { detachPassengerFavoriteGroupedRequests } from '@/lib/trip-request-favorite-ungroup';
import { createServiceClient } from '@/lib/supabase/server';
import {
  drainDriverDemandPassengerLeftPushQueue,
  sendDriverDemandPassengerLeftPush,
} from '@/lib/push/sendDriverDemandPassengerLeftPush';

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
    /** Preset de favorito (ej. home_to_gym) si la solicitud sale de Inicio / guardar favorito. */
    passenger_favorite_slot: z.string().max(120).optional(),
    /** Si ya hay una solicitud agrupada con el mismo slot/fecha/hora, el pasajero debe confirmar salida del grupo. */
    confirm_leave_group: z.boolean().optional(),
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

    const favSlot = p.passenger_favorite_slot?.trim();
    if (favSlot) row.passenger_favorite_slot = favSlot.slice(0, 120);
    const confirmLeaveGroup = p.confirm_leave_group === true;

    if (favSlot) {
      const { data: groupedHits, error: gErr } = await auth.supabase
        .from('trip_requests')
        .select('id')
        .eq('user_id', auth.user.id)
        .eq('passenger_favorite_slot', favSlot.slice(0, 120))
        .eq('requested_date', p.requested_date.trim())
        .eq('requested_time', p.requested_time.trim())
        .in('status', ['grouping', 'grouped', 'group_linked_pending']);
      if (gErr) {
        return NextResponse.json({ error: gErr.message }, { status: 400 });
      }
      const groupedCount = groupedHits?.length ?? 0;
      if (groupedCount > 0 && !confirmLeaveGroup) {
        return NextResponse.json(
          {
            code: 'GROUPED_FAVORITE_EXISTS',
            error:
              'Esta solicitud del favorito ya está en un grupo de demanda. Si guardás de nuevo, saldrás de ese grupo y se registrará una solicitud nueva para buscar otro grupo.',
          },
          { status: 409 }
        );
      }
      if (groupedCount > 0 && confirmLeaveGroup) {
        const service = createServiceClient();
        const detached = await detachPassengerFavoriteGroupedRequests(service, {
          userId: auth.user.id,
          favoriteSlot: favSlot.slice(0, 120),
          requestedDate: p.requested_date.trim(),
          requestedTime: p.requested_time.trim(),
        });
        if (!detached.ok) {
          if (detached.code === 'GROUP_HAS_ACTIVE_RIDE') {
            return NextResponse.json(
              { code: detached.code, error: detached.error },
              { status: 409 }
            );
          }
          return NextResponse.json({ error: detached.error }, { status: 400 });
        }
        void sendDriverDemandPassengerLeftPush(service, detached.notifyDriverRides);
      }
    }

    const hex = tripRequestSuperHexPair(p.origin_lat, p.origin_lng, p.destination_lat, p.destination_lng);
    row.origin_super_hex = hex.origin_super_hex;
    row.dest_super_hex = hex.dest_super_hex;

    if (kind === 'long_distance' && p.passenger_desired_price_per_seat_gs != null) {
      row.passenger_desired_price_per_seat_gs = Math.round(p.passenger_desired_price_per_seat_gs);
      row.internal_quote_acknowledged = null;
    } else {
      row.passenger_desired_price_per_seat_gs = null;
      row.internal_quote_acknowledged = p.internal_quote_acknowledged === true ? true : null;
    }

    type InsertedTripSummary = {
      id: string;
      requested_mode?: string | null;
      requested_time_start?: string | null;
      requested_time_end?: string | null;
      seats?: number | null;
      corridor_id?: string | null;
      time_bucket?: string | null;
      classification_status?: string | null;
      origin_node_key?: string | null;
      destination_node_key?: string | null;
    };
    let inserted: InsertedTripSummary | null = null;

    if (favSlot) {
      const up = await insertOrUpdatePendingTripRequestFromFavorite(auth.supabase, row);
      if (!up.ok) {
        console.error('[api/trip-requests] favorite pending upsert failed', {
          userId: auth.user.id,
          message: up.error,
        });
        return NextResponse.json({ error: up.error }, { status: 400 });
      }
      const { data: sel, error: selErr } = await auth.supabase
        .from('trip_requests')
        .select(
          'id, requested_mode, requested_time_start, requested_time_end, seats, corridor_id, time_bucket, classification_status, origin_node_key, destination_node_key'
        )
        .eq('id', up.id)
        .single();
      if (selErr || !sel) {
        console.error('[api/trip-requests] select after upsert failed', { message: selErr?.message });
        return NextResponse.json({ error: selErr?.message ?? 'No se pudo leer la solicitud.' }, { status: 400 });
      }
      inserted = sel as InsertedTripSummary;
    } else {
      const { data: ins, error } = await auth.supabase
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
      inserted = ins as InsertedTripSummary;
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

    void drainDriverDemandPassengerLeftPushQueue(createServiceClient()).catch((err) => {
      console.error('[api/trip-requests] drain push queue', err);
    });

    return NextResponse.json({ ok: true, id: inserted?.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
