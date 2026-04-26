import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

const SLOTS = new Set(['home_to_work', 'work_to_home']);
const HOME_SHORTCUT_WINDOW_MS = 60_000;
const HOME_SHORTCUT_MAX_PER_WINDOW = 30;

type Body = {
  delete?: boolean;
  slot?: string;
  enabled?: boolean;
  origin_label?: string | null;
  destination_label?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  scheduled_date?: string;
  scheduled_time?: string;
  /** HH:mm llegada deseada (modo llegada en app); null o vacío borra. */
  scheduled_arrival_time?: string | null;
  schedule_daily?: boolean;
};

function ymdOrToday(s: unknown): string {
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim();
  return new Date().toISOString().slice(0, 10);
}

function hmOrDefault(s: unknown): string {
  if (typeof s !== 'string') return '08:00';
  const t = s.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return '08:00';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function optionalHmOrNull(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/passenger/home-map-shortcut
 * Sincroniza atajo de Inicio para el mapa admin (Bearer = pasajero).
 * Escritura con service role tras validar JWT (evita fallos silenciosos por RLS en rutas API).
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient(request);
  const {
    data: { user },
    error: userErr,
  } = await authGetUser(supabase, request);
  if (userErr || !user?.id) {
    return json({ error: 'No autorizado' }, 401);
  }
  const clientId = getClientId(request, user.id);
  if (!checkRateLimit(`home-map-shortcut:${clientId}`, HOME_SHORTCUT_WINDOW_MS, HOME_SHORTCUT_MAX_PER_WINDOW)) {
    return json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, 429);
  }

  const service = createServiceClient();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const slot = typeof body.slot === 'string' ? body.slot : '';
  if (!SLOTS.has(slot)) {
    return json({ error: 'slot inválido' }, 400);
  }

  if (body.delete === true) {
    const { error } = await service.from('passenger_home_map_shortcuts').delete().eq('user_id', user.id).eq('slot', slot);
    if (error) {
      console.error('[passenger/home-map-shortcut] delete error:', error.message);
      return json({ error: 'No se pudo eliminar el atajo.' }, 400);
    }
    return json({ ok: true });
  }

  const enabled = Boolean(body.enabled);
  if (!enabled) {
    const { error } = await service.from('passenger_home_map_shortcuts').delete().eq('user_id', user.id).eq('slot', slot);
    if (error) {
      console.error('[passenger/home-map-shortcut] disable error:', error.message);
      return json({ error: 'No se pudo actualizar el atajo.' }, 400);
    }
    return json({ ok: true });
  }

  const olat = body.origin_lat;
  const olng = body.origin_lng;
  const dlat = body.destination_lat;
  const dlng = body.destination_lng;
  if (
    olat == null ||
    olng == null ||
    dlat == null ||
    dlng == null ||
    !Number.isFinite(Number(olat)) ||
    !Number.isFinite(Number(olng)) ||
    !Number.isFinite(Number(dlat)) ||
    !Number.isFinite(Number(dlng))
  ) {
    return json({ error: 'Faltan coordenadas válidas para el mapa' }, 400);
  }

  const row = {
    user_id: user.id,
    slot,
    enabled: true,
    origin_label: typeof body.origin_label === 'string' ? body.origin_label : null,
    destination_label: typeof body.destination_label === 'string' ? body.destination_label : null,
    origin_lat: Number(olat),
    origin_lng: Number(olng),
    destination_lat: Number(dlat),
    destination_lng: Number(dlng),
    scheduled_date: ymdOrToday(body.scheduled_date),
    scheduled_time: hmOrDefault(body.scheduled_time),
    schedule_daily: Boolean(body.schedule_daily),
    updated_at: new Date().toISOString(),
    ...('scheduled_arrival_time' in body
      ? { scheduled_arrival_time: optionalHmOrNull(body.scheduled_arrival_time) }
      : {}),
  };

  const { error } = await service.from('passenger_home_map_shortcuts').upsert(row, { onConflict: 'user_id,slot' });
  if (error) {
    console.error('[passenger/home-map-shortcut] upsert error:', error.message);
    return json({ error: 'No se pudo guardar el atajo.' }, 400);
  }
  return json({ ok: true });
}
