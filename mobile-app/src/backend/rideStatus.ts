/**
 * Actualiza estado del viaje (en_route, completed) vía API Next.js.
 * Ahí corre sendPassengersRideEnRoutePush (Expo) con SUPABASE_SERVICE_ROLE_KEY del deploy.
 *
 * Fallback: Edge Function ride-update-status (mismo contrato de auth) si no hay EXPO_PUBLIC_API_BASE_URL.
 */
import { env } from '../core/env';
import { supabase } from './supabase';

export type RideStatusUpdate = 'en_route' | 'completed';

const RIDE_STATUS_TIMEOUT_MS = 60_000;

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
    return { ok: false, error: 'config', details: 'API o Supabase URL no configurada' };
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
    let res = await run(accessToken);
    if (res.status === 401) {
      const { data: ref } = await supabase.auth.refreshSession();
      const t2 = ref.session?.access_token;
      if (t2 && t2 !== accessToken) {
        res = await run(t2);
      }
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) return { ok: false, error: 'unauthorized' };
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
