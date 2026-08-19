import type { SupabaseClient } from '@supabase/supabase-js';
import { insertOrUpdatePendingTripRequestFromFavorite } from '@/lib/trip-request-favorite-pending-upsert';
import { tripRequestSuperHexPair } from '@/lib/trip-request-h3';

const ACTIVE_DEMAND_STATUSES = ['pending', 'grouping', 'grouped', 'group_linked_pending'] as const;
/** Ventana hacia adelante para materializar atajos (días). */
const MATERIALIZE_DAYS_AHEAD = 21;

function todayYmdAsuncion(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeHm(raw: unknown): string | null {
  const m = String(raw ?? '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

type ShortcutRow = {
  user_id: string;
  slot: string;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  origin_label: string | null;
  destination_label: string | null;
  scheduled_date: string;
  scheduled_time: string;
};

export type MaterializeShortcutsResult = {
  scanned: number;
  createdOrUpdated: number;
  hexBackfilled: number;
  skippedExisting: number;
  skippedInvalid: number;
  errors: string[];
};

/**
 * Cierra el hueco atajo → demanda: los favoritos con switch activo viven en
 * `passenger_home_map_shortcuts` (mapa admin), pero el motor HEX solo lee `trip_requests`.
 * Antes de agrupar, crea/actualiza solicitudes pending hex-ready cuando falte la fila.
 */
export async function materializeEnabledShortcutsToTripRequests(
  service: SupabaseClient
): Promise<MaterializeShortcutsResult> {
  const from = todayYmdAsuncion();
  const to = addDaysYmd(from, MATERIALIZE_DAYS_AHEAD);
  const result: MaterializeShortcutsResult = {
    scanned: 0,
    createdOrUpdated: 0,
    hexBackfilled: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    errors: [],
  };

  const { data: shortcuts, error } = await service
    .from('passenger_home_map_shortcuts')
    .select(
      'user_id, slot, origin_lat, origin_lng, destination_lat, destination_lng, origin_label, destination_label, scheduled_date, scheduled_time'
    )
    .eq('enabled', true)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .limit(1000);

  if (error) {
    result.errors.push(error.message);
    return result;
  }

  const rows = (shortcuts ?? []) as ShortcutRow[];
  result.scanned = rows.length;

  for (const s of rows) {
    const olat = Number(s.origin_lat);
    const olng = Number(s.origin_lng);
    const dlat = Number(s.destination_lat);
    const dlng = Number(s.destination_lng);
    const hm = normalizeHm(s.scheduled_time);
    const slot = String(s.slot ?? '').trim();
    const uid = String(s.user_id ?? '').trim();
    const ymd = String(s.scheduled_date ?? '').trim();

    if (
      !uid ||
      !slot ||
      !ymd ||
      !hm ||
      !Number.isFinite(olat) ||
      !Number.isFinite(olng) ||
      !Number.isFinite(dlat) ||
      !Number.isFinite(dlng)
    ) {
      result.skippedInvalid += 1;
      continue;
    }

    const { data: existing, error: qErr } = await service
      .from('trip_requests')
      .select('id, status, origin_super_hex, dest_super_hex')
      .eq('user_id', uid)
      .eq('passenger_favorite_slot', slot)
      .eq('requested_date', ymd)
      .eq('requested_time', hm)
      .in('status', [...ACTIVE_DEMAND_STATUSES])
      .order('created_at', { ascending: true })
      .limit(5);

    if (qErr) {
      result.errors.push(`${uid}/${slot}: ${qErr.message}`);
      continue;
    }

    const hits = existing ?? [];
    if (hits.length > 0) {
      const pending = hits.find((h) => String((h as { status?: string }).status) === 'pending');
      if (pending) {
        const id = String((pending as { id: string }).id);
        const ohx = (pending as { origin_super_hex?: string | null }).origin_super_hex;
        const dhx = (pending as { dest_super_hex?: string | null }).dest_super_hex;
        if (!ohx || !dhx) {
          const hex = tripRequestSuperHexPair(olat, olng, dlat, dlng);
          const { error: uErr } = await service
            .from('trip_requests')
            .update({
              origin_super_hex: hex.origin_super_hex,
              dest_super_hex: hex.dest_super_hex,
              routing_engine: 'hex',
              origin_lat: olat,
              origin_lng: olng,
              destination_lat: dlat,
              destination_lng: dlng,
              origin_label: (String(s.origin_label ?? '').trim() || 'Origen').slice(0, 500),
              destination_label: (String(s.destination_label ?? '').trim() || 'Destino').slice(0, 500),
            })
            .eq('id', id);
          if (uErr) {
            result.errors.push(`${id}: ${uErr.message}`);
          } else {
            result.hexBackfilled += 1;
          }
          continue;
        }
      }
      result.skippedExisting += 1;
      continue;
    }

    const hex = tripRequestSuperHexPair(olat, olng, dlat, dlng);
    const insertRow: Record<string, unknown> = {
      user_id: uid,
      origin_lat: olat,
      origin_lng: olng,
      origin_label: (String(s.origin_label ?? '').trim() || 'Origen').slice(0, 500),
      destination_lat: dlat,
      destination_lng: dlng,
      destination_label: (String(s.destination_label ?? '').trim() || 'Destino').slice(0, 500),
      requested_date: ymd,
      requested_time: hm,
      requested_mode: 'scheduled',
      seats: 1,
      status: 'pending',
      pricing_kind: 'internal',
      internal_quote_acknowledged: true,
      routing_engine: 'hex',
      passenger_favorite_slot: slot,
      origin_super_hex: hex.origin_super_hex,
      dest_super_hex: hex.dest_super_hex,
    };

    const upsert = await insertOrUpdatePendingTripRequestFromFavorite(service, insertRow);
    if (!upsert.ok) {
      result.errors.push(`${uid}/${slot}/${ymd}: ${upsert.error}`);
      continue;
    }
    result.createdOrUpdated += 1;
  }

  return result;
}
