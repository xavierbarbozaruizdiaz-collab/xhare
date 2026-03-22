/**
 * Helpers to call Next.js API routes with Bearer token.
 * Used for: rate-driver, rate-passenger, arrive, extra-stops.
 */
import { env } from '../core/env';
import { supabase } from './supabase';

/** Red móvil + cold start (Vercel) pueden superar 20–25s en casos reales. */
const API_REQUEST_TIMEOUT_MS = 35_000;

function getApiBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

/** Mensaje de timeout: en producción (HTTPS remoto) no mezclar pistas de emulador/localhost. */
function timeoutMessageForApiBase(base: string): string {
  const trimmed = base.replace(/\/$/, '');
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2' || h.endsWith('.local')) {
      return 'Tiempo de espera: no hubo respuesta. En el emulador Android, localhost es el propio dispositivo; para Next.js en tu PC usá http://10.0.2.2:PUERTO.';
    }
  } catch {
    /* ignore */
  }
  return 'Tiempo de espera: el servidor no respondió a tiempo. Comprobá tu conexión e intentá de nuevo.';
}

async function apiRequest(
  path: string,
  options: { method: 'GET' } | { method: 'POST'; body: unknown }
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const base = getApiBase();
  if (!base) return { ok: false, status: 0, error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, status: 401, error: 'No hay sesión' };
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
  const init: RequestInit = {
    method: options.method,
    headers: { Authorization: `Bearer ${token}` },
  };
  if (options.method === 'POST') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    const bodyError = (data as { error?: string })?.error;
    return {
      ok: res.ok,
      status: res.status,
      data,
      error:
        bodyError ??
        (!res.ok
          ? res.status === 401
            ? 'No autorizado'
            : res.status === 403
              ? 'Acceso denegado'
              : res.status >= 500
                ? 'Error en el servidor'
                : `Error HTTP ${res.status}`
          : undefined),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: aborted ? timeoutMessageForApiBase(base) : e instanceof Error ? e.message : 'Error de red al llamar a la API',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiGet(
  path: string
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  return apiRequest(path, { method: 'GET' });
}

export async function apiPost(
  path: string,
  body: unknown
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  return apiRequest(path, { method: 'POST', body });
}

export async function rateDriver(rideId: string, stars: number) {
  return apiPost(`/api/rides/${rideId}/rate-driver`, { stars });
}

export async function ratePassenger(rideId: string, passengerId: string, stars: number) {
  return apiPost(`/api/rides/${rideId}/rate-passenger`, { passengerId, stars });
}

export async function arriveAtStop(
  rideId: string,
  stopOrder: number,
  passengers: Array<{ id: string; action: 'boarded' | 'no_show' | 'dropped_off' }>
) {
  return apiPost(`/api/rides/${rideId}/arrive`, { stopOrder, passengers });
}

export async function saveExtraStops(
  rideId: string,
  stops: Array<{ lat: number; lng: number; label?: string | null; order: number }>
) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return apiPost(`/api/rides/${rideId}/extra-stops`, { stops, access_token: token });
}
