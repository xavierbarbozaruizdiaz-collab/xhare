/**
 * Update ride status (en_route, completed) via Supabase Edge Function.
 * Same contract as web app. Timeout + refresh de sesión en 401 (cold start / token viejo).
 */
import { env } from '../core/env';
import { supabase } from './supabase';

export type RideStatusUpdate = 'en_route' | 'completed';

const RIDE_STATUS_TIMEOUT_MS = 60_000;

async function postRideStatus(
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

export async function updateRideStatus(
  rideId: string,
  status: RideStatusUpdate,
  accessToken: string
): Promise<{ ok: boolean; error?: string; details?: string }> {
  if (!env.supabaseUrl?.trim()) {
    return { ok: false, error: 'config', details: 'Supabase URL no configurada' };
  }

  const run = async (token: string): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RIDE_STATUS_TIMEOUT_MS);
    try {
      return await postRideStatus(rideId, status, token, controller.signal);
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

    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: 'unauthorized' };
    if (!res.ok) {
      return {
        ok: false,
        error: (data as { error?: string })?.error ?? 'unknown',
        details: (data as { details?: string })?.details,
      };
    }
    return { ok: (data as { ok?: boolean })?.ok !== false };
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
