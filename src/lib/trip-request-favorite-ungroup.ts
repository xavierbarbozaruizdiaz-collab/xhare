import type { SupabaseClient } from '@supabase/supabase-js';

/** Estados en los que el pedido ya entró al flujo de demanda agrupada. */
export const FAVORITE_GROUPED_STATUSES = ['grouping', 'grouped', 'group_linked_pending'] as const;

type DetachRpcResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
  reason?: string;
  cancelled_count?: number;
  notify_driver_rides?: unknown;
};

function parseDetachRpcPayload(data: unknown): DetachRpcResult | null {
  let raw: unknown = data;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      raw = JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as DetachRpcResult;
}

function detachRpcFailureMessage(body: DetachRpcResult): string {
  const m =
    (typeof body.message === 'string' && body.message.trim()) ||
    (typeof body.error === 'string' && body.error.trim()) ||
    (typeof body.reason === 'string' && body.reason.trim());
  return m || 'No se pudo salir del grupo.';
}

export type DetachFavoriteGroupedResult =
  | { ok: true; notifyDriverRides: Array<{ ride_id: string; group_id: string }> }
  | { ok: false; error: string; code?: string };

/**
 * RPC atómica en Postgres (`detach_passenger_favorite_grouped_requests`): miembros, cancelación,
 * conteos/base/archivo de grupo, cupos ride draft/awaiting_driver, bloqueo si ride activo.
 */
export async function detachPassengerFavoriteGroupedRequests(
  service: SupabaseClient,
  params: { userId: string; favoriteSlot: string; requestedDate: string; requestedTime: string }
): Promise<DetachFavoriteGroupedResult> {
  const { userId, favoriteSlot, requestedDate, requestedTime } = params;
  const slot = favoriteSlot.trim().slice(0, 120);

  const { data, error } = await service.rpc('detach_passenger_favorite_grouped_requests', {
    p_user_id: userId,
    p_favorite_slot: slot,
    p_requested_date: requestedDate.trim(),
    p_requested_time: requestedTime.trim(),
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const body = parseDetachRpcPayload(data);
  if (!body) {
    return { ok: false, error: 'Respuesta inválida del servidor.' };
  }
  if (body.ok !== true) {
    return {
      ok: false,
      error: detachRpcFailureMessage(body),
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  }

  const raw = body.notify_driver_rides;
  const notifyDriverRides = Array.isArray(raw)
    ? raw
        .map((x) => ({
          ride_id: String((x as { ride_id?: unknown }).ride_id ?? ''),
          group_id: String((x as { group_id?: unknown }).group_id ?? ''),
        }))
        .filter((x) => x.ride_id.length > 0)
    : [];

  return { ok: true, notifyDriverRides };
}

/**
 * RPC `detach_trip_request_from_demand_group`: salir del grupo por id de solicitud
 * (con slot de favorito delega en `detach_passenger_favorite_grouped_requests`).
 */
export async function detachTripRequestFromDemandGroup(
  service: SupabaseClient,
  params: { userId: string; tripRequestId: string }
): Promise<DetachFavoriteGroupedResult> {
  const { userId, tripRequestId } = params;
  const { data, error } = await service.rpc('detach_trip_request_from_demand_group', {
    p_trip_request_id: tripRequestId,
    p_user_id: userId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const body = parseDetachRpcPayload(data);
  if (!body) {
    return { ok: false, error: 'Respuesta inválida del servidor.' };
  }
  if (body.ok !== true) {
    return {
      ok: false,
      error: detachRpcFailureMessage(body),
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  }

  const raw = body.notify_driver_rides;
  const notifyDriverRides = Array.isArray(raw)
    ? raw
        .map((x) => ({
          ride_id: String((x as { ride_id?: unknown }).ride_id ?? ''),
          group_id: String((x as { group_id?: unknown }).group_id ?? ''),
        }))
        .filter((x) => x.ride_id.length > 0)
    : [];

  return { ok: true, notifyDriverRides };
}
