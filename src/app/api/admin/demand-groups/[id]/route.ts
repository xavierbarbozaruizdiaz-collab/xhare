import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { buildDemandRouteGroupDetailResult } from '@/lib/demand-route-group-detail-build';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-groups-id';

const ACTIVE_RIDE_STATUSES = ['published', 'booked', 'en_route'] as const;

/**
 * GET /api/admin/demand-groups/[id]
 * Mismo payload que GET /api/demand-routes/[id] pero con `withAdminAuth` (evita 401 en panel cuando el JWT
 * no llega bien a `createServerClient` + `auth.getUser` en algunos despliegues).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAdminAuth(request, async () => {
    try {
      const { id } = await params;
      if (!id || !String(id).trim()) {
        return NextResponse.json({ error: 'id requerido' }, { status: 400 });
      }
      const service = createServiceClient();
      const result = await buildDemandRouteGroupDetailResult(service, id);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      logBlockOk(`${BLOCK}-get`);
      return NextResponse.json(result.body);
    } catch (e) {
      logBlockError(`${BLOCK}-get`, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

/**
 * DELETE /api/admin/demand-groups/[id]
 * Disuelve el agrupamiento: cancela ride de sistema (awaiting_driver/draft), libera pedidos a `pending`,
 * borra members y el grupo. Bloquea si el viaje asociado está activo.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAdminAuth(request, async () => {
    try {
      const { id: groupId } = await params;
      if (!groupId || !String(groupId).trim()) {
        return NextResponse.json({ error: 'id requerido' }, { status: 400 });
      }

      const service = createServiceClient();
      const { data: group, error: gErr } = await service
        .from('demand_route_groups')
        .select('id, ride_id')
        .eq('id', groupId)
        .maybeSingle();

      if (gErr || !group) {
        return NextResponse.json({ error: 'Grupo no encontrado' }, { status: 404 });
      }

      const rideId = group.ride_id != null ? String(group.ride_id).trim() : '';

      if (rideId) {
        const { data: ride, error: rErr } = await service
          .from('rides')
          .select('id, status')
          .eq('id', rideId)
          .maybeSingle();
        if (rErr) {
          logBlockError(BLOCK, rErr.message, rErr);
          return NextResponse.json({ error: rErr.message }, { status: 400 });
        }
        const st = String(ride?.status ?? '');
        if (ACTIVE_RIDE_STATUSES.includes(st as (typeof ACTIVE_RIDE_STATUSES)[number])) {
          return NextResponse.json(
            {
              error:
                'Este grupo tiene un viaje publicado o en curso. Cancelá o completá ese viaje desde la app o el panel de Viajes antes de disolver el agrupamiento.',
            },
            { status: 409 }
          );
        }
        if (st === 'awaiting_driver' || st === 'draft') {
          const nowIso = new Date().toISOString();
          const { error: bErr } = await service
            .from('bookings')
            .update({ status: 'cancelled', updated_at: nowIso })
            .eq('ride_id', rideId)
            .neq('status', 'cancelled');
          if (bErr) {
            logBlockError(BLOCK, `bookings: ${bErr.message}`, bErr);
            return NextResponse.json({ error: bErr.message }, { status: 400 });
          }
          const { error: rideUpdErr } = await service
            .from('rides')
            .update({
              status: 'cancelled',
              driver_id: null,
              started_at: null,
              current_stop_index: 0,
              awaiting_stop_confirmation: false,
              driver_lat: null,
              driver_lng: null,
              driver_location_updated_at: null,
            })
            .eq('id', rideId);
          if (rideUpdErr) {
            logBlockError(BLOCK, `rides: ${rideUpdErr.message}`, rideUpdErr);
            return NextResponse.json({ error: rideUpdErr.message }, { status: 400 });
          }
        }
      }

      const { data: members, error: mErr } = await service
        .from('demand_route_members')
        .select('trip_request_id')
        .eq('group_id', groupId);
      if (mErr) {
        logBlockError(BLOCK, mErr.message, mErr);
        return NextResponse.json({ error: mErr.message }, { status: 400 });
      }
      const memberTripIds = Array.from(
        new Set(
          (members ?? [])
            .map((m) => String((m as { trip_request_id?: string }).trip_request_id ?? '').trim())
            .filter((x) => x.length > 0)
        )
      );

      const nowIso = new Date().toISOString();

      const { error: uPool } = await service
        .from('trip_requests')
        .update({
          status: 'pending',
          demand_group_id: null,
          ride_id: null,
          updated_at: nowIso,
        })
        .eq('demand_group_id', groupId)
        .in('status', ['grouping', 'grouped', 'group_linked_pending']);
      if (uPool) {
        logBlockError(BLOCK, `trip_requests pool: ${uPool.message}`, uPool);
        return NextResponse.json({ error: uPool.message }, { status: 400 });
      }

      if (rideId) {
        const { error: uAcc } = await service
          .from('trip_requests')
          .update({
            status: 'pending',
            demand_group_id: null,
            ride_id: null,
            updated_at: nowIso,
          })
          .eq('demand_group_id', groupId)
          .eq('status', 'accepted')
          .eq('ride_id', rideId);
        if (uAcc) {
          logBlockError(BLOCK, `trip_requests accepted/dispatch: ${uAcc.message}`, uAcc);
          return NextResponse.json({ error: uAcc.message }, { status: 400 });
        }
      }

      const { error: uClear } = await service
        .from('trip_requests')
        .update({ demand_group_id: null, updated_at: nowIso })
        .eq('demand_group_id', groupId);
      if (uClear) {
        logBlockError(BLOCK, `trip_requests clear demand_group_id: ${uClear.message}`, uClear);
        return NextResponse.json({ error: uClear.message }, { status: 400 });
      }

      if (memberTripIds.length > 0) {
        const { error: uOrphan } = await service
          .from('trip_requests')
          .update({
            status: 'pending',
            demand_group_id: null,
            ride_id: null,
            updated_at: nowIso,
          })
          .in('id', memberTripIds)
          .in('status', ['grouping', 'grouped', 'group_linked_pending']);
        if (uOrphan) {
          logBlockError(BLOCK, `trip_requests members orphan: ${uOrphan.message}`, uOrphan);
          return NextResponse.json({ error: uOrphan.message }, { status: 400 });
        }
      }

      const { error: delM } = await service.from('demand_route_members').delete().eq('group_id', groupId);
      if (delM) {
        logBlockError(BLOCK, `demand_route_members: ${delM.message}`, delM);
        return NextResponse.json({ error: delM.message }, { status: 400 });
      }

      const { error: delG } = await service.from('demand_route_groups').delete().eq('id', groupId);
      if (delG) {
        logBlockError(BLOCK, `demand_route_groups: ${delG.message}`, delG);
        return NextResponse.json({ error: delG.message }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        dissolvedGroupId: groupId,
        cancelledSystemRideId: rideId || null,
        resetTripRequestIdsSample: memberTripIds.slice(0, 12),
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
