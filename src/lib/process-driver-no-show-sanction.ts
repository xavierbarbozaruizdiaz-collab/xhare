import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPassengersRideCancelledPush } from '@/lib/push/sendPassengersRideCancelledPush';
import { fetchActiveDriverDebtLimitDefault } from '@/lib/driver-debt-limit';

const NO_SHOW_BLOCK_DAYS = 7;

async function isGroupedDemandRide(service: SupabaseClient, rideId: string): Promise<boolean> {
  const { data: groupRow } = await service.from('demand_route_groups').select('id').eq('ride_id', rideId).maybeSingle();
  if (groupRow?.id) return true;
  const { data: groupedTrips } = await service
    .from('trip_requests')
    .select('id')
    .eq('ride_id', rideId)
    .not('demand_group_id', 'is', null)
    .limit(1);
  if (groupedTrips && groupedTrips.length > 0) return true;
  const { data: groupedByMembers } = await service
    .from('demand_route_members')
    .select('trip_request_id, trip_requests!inner(id, ride_id)')
    .eq('trip_requests.ride_id', rideId)
    .limit(1);
  return Boolean(groupedByMembers && groupedByMembers.length > 0);
}

async function relinkDemandGroupRide(service: SupabaseClient, rideId: string): Promise<void> {
  try {
    const { data: trOne } = await service
      .from('trip_requests')
      .select('demand_group_id')
      .eq('ride_id', rideId)
      .not('demand_group_id', 'is', null)
      .limit(1)
      .maybeSingle();
    const dg =
      trOne?.demand_group_id != null && String(trOne.demand_group_id).trim() !== ''
        ? String(trOne.demand_group_id).trim()
        : '';
    if (dg) {
      const { error: relErr } = await service.from('demand_route_groups').update({ ride_id: rideId }).eq('id', dg);
      if (relErr) console.warn('[no-show] demand_route_groups ride_id relink failed', relErr);
    }
  } catch (e) {
    console.warn('[no-show] demand_route_groups ride_id relink', e);
  }
}

/**
 * Viaje publicado/reservado cuya salida ya pasó y el conductor nunca inició: bloqueo operativo 7 días,
 * cancelación de reservas y cierre/re-despacho. Idempotente: solo filas con `driver_no_show_processed_at` NULL.
 */
export async function processRideNoShowSanction(service: SupabaseClient, rideId: string): Promise<boolean> {
  const grouped = await isGroupedDemandRide(service, rideId);
  const now = new Date();
  const nowIso = now.toISOString();
  const until = new Date(now.getTime() + NO_SHOW_BLOCK_DAYS * 24 * 60 * 60 * 1000);

  const updatePayload: Record<string, unknown> = {
    driver_no_show_processed_at: nowIso,
    status: 'cancelled' as const,
  };
  if (grouped) {
    updatePayload.status = 'awaiting_driver';
    updatePayload.driver_id = null;
    updatePayload.started_at = null;
    updatePayload.current_stop_index = 0;
    updatePayload.awaiting_stop_confirmation = false;
    updatePayload.driver_lat = null;
    updatePayload.driver_lng = null;
    updatePayload.driver_location_updated_at = null;
  }

  const { data: updatedRide, error: upErr } = await service
    .from('rides')
    .update(updatePayload)
    .eq('id', rideId)
    .in('status', ['published', 'booked'])
    .is('driver_no_show_processed_at', null)
    .not('driver_id', 'is', null)
    .select('id, status, driver_id')
    .maybeSingle();

  if (upErr || !updatedRide?.driver_id) {
    return false;
  }

  const driverId = String(updatedRide.driver_id);

  const { data: acc } = await service.from('driver_accounts').select('driver_id').eq('driver_id', driverId).maybeSingle();
  if (acc?.driver_id) {
    await service
      .from('driver_accounts')
      .update({
        operational_blocked_until: until.toISOString(),
        operational_block_reason: 'no_show_departure',
        updated_at: nowIso,
      })
      .eq('driver_id', driverId);
  } else {
    const debtLimit = await fetchActiveDriverDebtLimitDefault(service);
    await service.from('driver_accounts').insert({
      driver_id: driverId,
      account_status: 'active',
      debt_pyg: 0,
      debt_limit_pyg: debtLimit,
      operational_blocked_until: until.toISOString(),
      operational_block_reason: 'no_show_departure',
      updated_at: nowIso,
    });
  }

  await service.from('bookings').update({ status: 'cancelled', updated_at: nowIso }).eq('ride_id', rideId).neq('status', 'cancelled');

  try {
    await sendPassengersRideCancelledPush(service, rideId);
  } catch (e) {
    console.error('[no-show] passenger cancelled push failed', e);
  }

  if (String(updatedRide.status) === 'awaiting_driver') {
    await relinkDemandGroupRide(service, rideId);
  }

  return true;
}
