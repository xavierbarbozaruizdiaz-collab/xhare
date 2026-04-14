import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { withAdminAuth, logBlockError, logBlockOk } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'dispatch-map-data';

/** Estados de demanda visibles en el mapa de despacho (no viaje ya cerrado al pasajero). */
const DEMAND_STATUSES = ['pending', 'grouping', 'grouped', 'group_linked_pending'] as const;

/**
 * GET /api/admin/dispatch-map-data?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Pedidos de pasajeros con coordenadas, grupos de demanda y rides generados por sistema.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const service = createServiceClient();
      const { searchParams } = new URL(request.url);
      const today = new Date().toISOString().slice(0, 10);
      const from = searchParams.get('from') ?? today;
      const toParam = searchParams.get('to');
      const toDate = new Date(from + 'T12:00:00');
      if (Number.isNaN(toDate.getTime())) {
        return NextResponse.json({ error: 'from inválido' }, { status: 400 });
      }
      const to =
        toParam ??
        new Date(toDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [
        { data: tripRows, error: tripErr },
        { data: rideRows, error: rideErr },
        { data: groupRows, error: groupErr },
        { data: shortcutRowsRaw, error: shortcutErr },
      ] = await Promise.all([
          service
            .from('trip_requests')
            .select(
              'id, origin_lat, origin_lng, destination_lat, destination_lng, origin_label, destination_label, requested_date, requested_time, requested_time_start, requested_time_end, status, pricing_kind, passenger_desired_price_per_seat_gs'
            )
            .in('status', [...DEMAND_STATUSES])
            .gte('requested_date', from)
            .lte('requested_date', to)
            .order('requested_date', { ascending: true })
            .order('requested_time', { ascending: true })
            .limit(500),
          service
            .from('rides')
            .select(
              'id, origin_lat, origin_lng, destination_lat, destination_lng, origin_label, destination_label, departure_time, status, available_seats, total_seats'
            )
            .eq('status', 'awaiting_driver')
            .gte('departure_time', `${from}T00:00:00.000Z`)
            .lte('departure_time', `${to}T23:59:59.999Z`)
            .order('departure_time', { ascending: true })
            .limit(200),
          service
            .from('demand_route_groups')
            .select(
              'id, origin_city, destination_city, requested_date, requested_time, passenger_count, ride_id, base_trip_request_id'
            )
            .gte('requested_date', from)
            .lte('requested_date', to)
            .order('requested_date', { ascending: true })
            .order('requested_time', { ascending: true })
            .limit(200),
          service
            .from('passenger_home_map_shortcuts')
            .select(
              'user_id, slot, origin_lat, origin_lng, destination_lat, destination_lng, origin_label, destination_label, scheduled_date, scheduled_time, schedule_daily, schedule_weekday_mask, updated_at'
            )
            .eq('enabled', true)
            .gte('scheduled_date', from)
            .lte('scheduled_date', to)
            .order('updated_at', { ascending: false })
            .limit(500),
        ]);

      if (tripErr) {
        logBlockError(BLOCK, tripErr.message, tripErr);
        return NextResponse.json({ error: tripErr.message }, { status: 400 });
      }
      if (rideErr) {
        logBlockError(BLOCK, rideErr.message, rideErr);
        return NextResponse.json({ error: rideErr.message }, { status: 400 });
      }
      if (groupErr) {
        logBlockError(BLOCK, groupErr.message, groupErr);
        return NextResponse.json({ error: groupErr.message }, { status: 400 });
      }
      let passengerHomeShortcuts: unknown[] = [];
      let passengerHomeShortcutsError: string | null = null;
      if (shortcutErr) {
        logBlockError(BLOCK, `passenger_home_map_shortcuts (se omite): ${shortcutErr.message}`, shortcutErr);
        passengerHomeShortcuts = [];
        passengerHomeShortcutsError = shortcutErr.message;
      } else {
        /** Atajos: misma ventana de fechas que pedidos (`scheduled_date` = fecha que confirmó el pasajero al activar). */
        passengerHomeShortcuts = shortcutRowsRaw ?? [];
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        from,
        to,
        tripRequests: tripRows ?? [],
        systemRides: rideRows ?? [],
        demandGroups: groupRows ?? [],
        passengerHomeShortcuts,
        passengerHomeShortcutsError,
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
