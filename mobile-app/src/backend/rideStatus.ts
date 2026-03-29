/**
 * Actualiza estado del viaje (en_route, completed) vía API Next.js.
 * Ahí corre sendPassengersRideEnRoutePush (Expo) con SUPABASE_SERVICE_ROLE_KEY del deploy.
 *
 * Si Next responde 401 (JWT no aceptado por el deploy aunque la sesión móvil sea válida para Supabase),
 * se reintenta la misma regla de negocio con update directo vía Supabase + RLS.
 *
 * Fallback: Edge Function ride-update-status si no hay EXPO_PUBLIC_API_BASE_URL.
 */
import { env } from '../core/env';
import { supabase } from './supabase';

export type RideStatusUpdate = 'en_route' | 'completed';

const RIDE_STATUS_TIMEOUT_MS = 60_000;

/** Misma lógica esencial que `POST /api/rides/:id/update-status` para poder operar sin Next si el JWT falla allí. */
async function updateRideStatusDirectSupabase(
  rideId: string,
  status: RideStatusUpdate
): Promise<{ ok: boolean; error?: string; details?: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'unauthorized' };
  }

  const { data: driverAccount } = await supabase
    .from('driver_accounts')
    .select('account_status')
    .eq('driver_id', user.id)
    .maybeSingle();
  if (driverAccount?.account_status === 'suspended') {
    return {
      ok: false,
      error: 'account_suspended',
      details: 'Tu cuenta está suspendida por deuda pendiente. Contactá a soporte para regularizar.',
    };
  }

  if (status === 'en_route') {
    const { data: otherEnRoute, error: otherErr } = await supabase
      .from('rides')
      .select('id')
      .eq('driver_id', user.id)
      .eq('status', 'en_route')
      .neq('id', rideId)
      .limit(1);
    if (otherErr) {
      return { ok: false, error: 'update_failed', details: otherErr.message };
    }
    if (otherEnRoute && otherEnRoute.length > 0) {
      return {
        ok: false,
        error: 'already_has_active_ride',
        details: 'Ya tenés un viaje en curso. Finalizá ese viaje antes de iniciar otro.',
      };
    }
  }

  const updatePayload: Record<string, unknown> = { status };
  if (status === 'en_route') {
    updatePayload.started_at = new Date().toISOString();
    updatePayload.current_stop_index = 0;
    updatePayload.awaiting_stop_confirmation = false;
  }
  if (status === 'completed') {
    updatePayload.driver_lat = null;
    updatePayload.driver_lng = null;
    updatePayload.driver_location_updated_at = null;
  }

  const { error: upErr } = await supabase
    .from('rides')
    .update(updatePayload)
    .eq('id', rideId)
    .eq('driver_id', user.id);

  if (upErr) {
    return { ok: false, error: 'update_failed', details: upErr.message };
  }
  return { ok: true };
}

async function postNextUpdateStatus(
  rideId: string,
  status: RideStatusUpdate,
  accessToken: string,
  signal: AbortSignal
): Promise<Response> {
  const base = env.apiBaseUrl.replace(/\/$/, '');
  return fetch(`${base}/api/rides/${encodeURIComponent(rideId)}/update-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ status }),
    signal,
  });
}

async function postEdgeRideStatus(
  rideId: string,
  status: RideStatusUpdate,
  accessToken: string,
  signal: AbortSignal
): Promise<Response> {
  const url = `${env.supabaseUrl}/functions/v1/ride-update-status`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ ride_id: rideId, status }),
    signal,
  });
}

/**
 * Token que entrega getSession() en handlers/UI puede estar vencido; Next valida JWT en cada request.
 * Refrescar primero evita 401 masivos en Iniciar/Finalizar viaje.
 */
async function resolveAccessTokenForApi(fallbackFromCaller: string): Promise<string | null> {
  try {
    const { data: ref } = await supabase.auth.refreshSession();
    const t = ref.session?.access_token?.trim();
    if (t) return t;
  } catch {
    /* seguir con getSession */
  }
  const { data: s } = await supabase.auth.getSession();
  const t2 = s.session?.access_token?.trim();
  if (t2) return t2;
  return fallbackFromCaller?.trim() || null;
}

function parseStatusResponse(data: Record<string, unknown>): {
  ok: boolean;
  error?: string;
  details?: string;
} {
  if (data.success === true || data.ok === true) return { ok: true };
  const errRaw = data.error;
  const errStr =
    typeof errRaw === 'string'
      ? errRaw
      : Array.isArray(errRaw)
        ? 'validation_error'
        : 'unknown';
  const details =
    typeof data.details === 'string'
      ? data.details
      : typeof errRaw === 'string'
        ? errRaw
        : undefined;
  return { ok: false, error: errStr, details };
}

export async function updateRideStatus(
  rideId: string,
  status: RideStatusUpdate,
  accessToken: string
): Promise<{ ok: boolean; error?: string; details?: string }> {
  const useNext = Boolean(env.apiBaseUrl?.trim());
  if (!useNext && !env.supabaseUrl?.trim()) {
    return {
      ok: false,
      error: 'config',
      details: 'Esta versión de la app no tiene bien configurado el servidor. Contactá a soporte.',
    };
  }

  const run = async (token: string): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RIDE_STATUS_TIMEOUT_MS);
    try {
      if (useNext) {
        return await postNextUpdateStatus(rideId, status, token, controller.signal);
      }
      return await postEdgeRideStatus(rideId, status, token, controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let token = await resolveAccessTokenForApi(accessToken);
    if (!token) {
      return { ok: false, error: 'unauthorized' };
    }

    let res = await run(token);
    if (res.status === 401) {
      const { data: ref } = await supabase.auth.refreshSession();
      const t2 = ref.session?.access_token?.trim();
      if (t2 && t2 !== token) {
        token = t2;
        res = await run(token);
      }
    }

    if (res.status === 401) {
      const direct = await updateRideStatusDirectSupabase(rideId, status);
      if (direct.ok) {
        return { ok: true };
      }
      return { ok: false, error: direct.error ?? 'unauthorized', details: direct.details };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const parsed = parseStatusResponse(data);
      return {
        ok: false,
        error: parsed.error ?? 'unknown',
        details: parsed.details,
      };
    }
    return parseStatusResponse(data);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? 'timeout' : 'network',
      details: aborted
        ? 'El servidor tardó demasiado (a veces pasa en el primer intento). Probá de nuevo.'
        : e instanceof Error
          ? e.message
          : 'Error de red',
    };
  }
}
