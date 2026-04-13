import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';

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
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  const enabled = Boolean(body.enabled);
  if (!enabled) {
    const { error } = await service.from('passenger_home_map_shortcuts').delete().eq('user_id', user.id).eq('slot', slot);
    if (error) return json({ error: error.message }, 400);
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
  };

  const { error } = await service.from('passenger_home_map_shortcuts').upsert(row, { onConflict: 'user_id,slot' });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
