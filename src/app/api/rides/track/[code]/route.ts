import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';
import { formatVehicleInfoLabel } from '@/lib/vehicle-info';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 45;

type Point = { lat: number; lng: number };

function normalizeShareCode(raw: string): string | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{5,32}$/.test(s)) return null;
  return s;
}

function parseBaseRoutePolyline(raw: unknown): Point[] {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const out: Point[] = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const o = p as { lat?: unknown; lng?: unknown };
      const lat = Number(o.lat);
      const lng = Number(o.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    } else if (Array.isArray(p) && p.length >= 2) {
      const lng = Number(p[0]);
      const lat = Number(p[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
  }
  return out.length >= 2 ? out : [];
}

function decimatePolyline(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  if (!prev || prev.lat !== last.lat || prev.lng !== last.lng) out.push(last);
  return out;
}

function firstName(fullName: string | null | undefined): string | null {
  if (!fullName || typeof fullName !== 'string') return null;
  const t = fullName.trim();
  if (!t) return null;
  const parts = t.split(/\s+/);
  return parts[0] ?? null;
}

/**
 * GET público: estado del viaje para compartir con contactos de confianza (sin login).
 * Identificador: `share_code` del ride (único). No expone datos de pasajeros ni teléfonos.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeShareCode(rawCode ?? '');
  if (!code) {
    return NextResponse.json({ error: 'Código inválido' }, { status: 400 });
  }

  if (!checkRateLimit(`ride-track:${getClientId(request)}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
  }

  const service = createServiceClient();
  const { data: row, error } = await service
    .from('rides')
    .select(
      `id, status, share_code, departure_time, origin_label, destination_label, route_name,
       driver_lat, driver_lng, driver_location_updated_at, vehicle_info, base_route_polyline,
       driver:profiles!rides_driver_id_fkey(full_name)`
    )
    .eq('share_code', code)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 });
  }

  const r = row as Record<string, unknown>;
  const rideId = String(r.id ?? '');
  const status = String(r.status ?? '');
  const bookingId = request.nextUrl.searchParams.get('b')?.trim() ?? '';

  if (bookingId) {
    const { data: dropped } = await service
      .from('ride_boarding_events')
      .select('id')
      .eq('ride_id', rideId)
      .eq('booking_id', bookingId)
      .eq('event_type', 'dropped_off')
      .limit(1);
    if (dropped && dropped.length > 0) {
      return NextResponse.json(
        {
          error: 'El seguimiento finalizó: el pasajero ya bajó del minibús.',
          ended: true,
          reason: 'passenger_dropped_off',
        },
        { status: 410 }
      );
    }
  }

  if (status === 'completed' || status === 'cancelled') {
    return NextResponse.json(
      {
        error: 'El viaje ya no está en curso. El seguimiento en vivo no está disponible.',
        ended: true,
        reason: 'ride_finished',
      },
      { status: 410 }
    );
  }
  const driverRow = r.driver as { full_name?: string } | null | undefined;
  const driverFirst = firstName(driverRow?.full_name ?? null);

  const poly = decimatePolyline(parseBaseRoutePolyline(r.base_route_polyline), 48);

  const base = {
    ok: true as const,
    share_code: String(r.share_code ?? code),
    status,
    departure_time: r.departure_time != null ? String(r.departure_time) : null,
    origin_label: r.origin_label != null ? String(r.origin_label) : null,
    destination_label: r.destination_label != null ? String(r.destination_label) : null,
    route_name: r.route_name != null ? String(r.route_name) : null,
    vehicle_info: formatVehicleInfoLabel(r.vehicle_info),
    driver_first_name: driverFirst,
    base_route_polyline: status !== 'cancelled' ? poly : [],
  };

  if (status === 'en_route') {
    const lat = Number(r.driver_lat);
    const lng = Number(r.driver_lng);
    return NextResponse.json({
      ...base,
      driver_lat: Number.isFinite(lat) ? lat : null,
      driver_lng: Number.isFinite(lng) ? lng : null,
      driver_location_updated_at:
        r.driver_location_updated_at != null ? String(r.driver_location_updated_at) : null,
    });
  }

  return NextResponse.json({
    ...base,
    driver_lat: null,
    driver_lng: null,
    driver_location_updated_at: null,
  });
}
