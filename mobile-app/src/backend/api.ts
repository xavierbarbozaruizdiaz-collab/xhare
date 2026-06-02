/**
 * Helpers to call Next.js API routes with Bearer token.
 * Used for: rate-driver, rate-passenger, arrive, extra-stops.
 */
import { env } from '../core/env';
import { supabase } from './supabase';

/** Red móvil + cold start (Vercel) pueden superar 20–25s en casos reales. */
const API_REQUEST_TIMEOUT_MS = 35_000;
const TOKEN_EXPIRY_SKEW_SEC = 45;
let refreshInFlight: Promise<string | null> | null = null;

function validSessionToken(
  session: { access_token?: string | null; expires_at?: number | null } | null | undefined
): string | null {
  const token = session?.access_token?.trim() ?? '';
  if (!token) return null;
  const exp = Number(session?.expires_at ?? 0);
  if (!Number.isFinite(exp) || exp <= 0) return token;
  const nowSec = Math.floor(Date.now() / 1000);
  return exp > nowSec + TOKEN_EXPIRY_SKEW_SEC ? token : null;
}

async function refreshAccessTokenSingleFlight(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const { data: fresh } = await supabase.auth.refreshSession();
      return validSessionToken(fresh.session);
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function resolveApiAccessToken(options?: { forceRefresh?: boolean }): Promise<string | null> {
  const forceRefresh = Boolean(options?.forceRefresh);
  if (!forceRefresh) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = validSessionToken(session);
    if (token) return token;
  }

  const refreshed = await refreshAccessTokenSingleFlight();
  if (refreshed) return refreshed;

  try {
    const {
      data: { session: fallbackSession },
    } = await supabase.auth.getSession();
    return validSessionToken(fallbackSession);
  } catch {
    return null;
  }
}

function getApiBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

/** Registra o actualiza el perfil como `driver_pending` (misma ruta que la web en signup conductor). */
export async function ensureDriverPendingProfile(options?: {
  full_name?: string;
  phone?: string;
  address?: string;
  city?: string;
}): Promise<{ ok: boolean; role?: string; error?: string }> {
  const base = getApiBase();
  if (!base) {
    return { ok: false, error: 'EXPO_PUBLIC_API_BASE_URL no configurado' };
  }

  let lastError = 'No autenticado';
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await resolveApiAccessToken({ forceRefresh: attempt > 0 });
    if (!token) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    try {
      const res = await fetch(`${base}/api/auth/ensure-driver-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          full_name: options?.full_name,
          phone: options?.phone,
          address: options?.address,
          city: options?.city,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; role?: string; error?: string };
      if (res.ok) {
        return { ok: true, role: typeof json.role === 'string' ? json.role : 'driver_pending' };
      }
      lastError = json.error || `Error ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Error de red';
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, error: lastError };
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
  const token = await resolveApiAccessToken();
  if (!token) return { ok: false, status: 401, error: 'No hay sesión' };
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`;

  const buildInit = (bearer: string): RequestInit => {
    const headers: Record<string, string> = { Authorization: `Bearer ${bearer}` };
    if (options.method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    return {
      method: options.method,
      headers,
      ...(options.method === 'POST' ? { body: JSON.stringify(options.body) } : {}),
    };
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    let res = await fetch(url, { ...buildInit(token), signal: controller.signal });
    if (res.status === 401) {
      const t2 = await resolveApiAccessToken({ forceRefresh: true });
      if (t2 && t2 !== token) {
        res = await fetch(url, { ...buildInit(t2), signal: controller.signal });
      }
    }
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

/** Conductor toma un ride despachado (awaiting_driver) → published + driver_id. Requiere EXPO_PUBLIC_API_BASE_URL. */
export async function assignDispatchRide(rideId: string) {
  return apiPost('/api/rides/assign-driver', { ride_id: rideId });
}

export async function rateDriver(rideId: string, stars: number, comment?: string) {
  const body: Record<string, unknown> = { stars };
  const trimmed = comment?.trim();
  if (trimmed) body.comment = trimmed.slice(0, 500);
  const token = await resolveApiAccessToken({ forceRefresh: true });
  if (!token) throw new Error('No hay sesión activa. Volvé a iniciar sesión.');
  body.access_token = token;
  const res = await apiPost(`/api/rides/${rideId}/rate-driver`, body);
  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'Sesión expirada. Volvé a iniciar sesión e intentá de nuevo.'
        : (res.error ?? 'No se pudo enviar la calificación');
    throw new Error(msg);
  }
  return res;
}

export async function ratePassenger(rideId: string, passengerId: string, stars: number, comment?: string) {
  const body: Record<string, unknown> = { passengerId, stars };
  const trimmed = comment?.trim();
  if (trimmed) body.comment = trimmed.slice(0, 500);
  const token = await resolveApiAccessToken({ forceRefresh: true });
  if (!token) throw new Error('No hay sesión activa. Volvé a iniciar sesión.');
  body.access_token = token;
  const res = await apiPost(`/api/rides/${rideId}/rate-passenger`, body);
  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'Sesión expirada. Volvé a iniciar sesión e intentá de nuevo.'
        : (res.error ?? 'No se pudo enviar la calificación');
    throw new Error(msg);
  }
  return res;
}

export type ArriveVisitPayload = {
  stopOrder: number;
  passengers: Array<{ id: string; action: 'boarded' | 'no_show' | 'dropped_off' }>;
  anchorLat: number;
  anchorLng: number;
  visitKind: 'pickup' | 'dropoff' | 'published';
  visitBookingId?: string;
  driverLat?: number;
  driverLng?: number;
};

/** Bajada manual: pasajero ya subió; sin exigir proximidad al punto de bajada. */
export async function registerPassengerDropoff(rideId: string, bookingId: string) {
  const body: Record<string, unknown> = { bookingId };
  const token = await resolveApiAccessToken({ forceRefresh: true });
  if (token) body.access_token = token;
  return apiPost(`/api/rides/${rideId}/dropoff-passenger`, body);
}

export async function arriveAtStop(rideId: string, payload: ArriveVisitPayload) {
  const body: Record<string, unknown> = {
    stopOrder: payload.stopOrder,
    passengers: payload.passengers,
    anchorLat: payload.anchorLat,
    anchorLng: payload.anchorLng,
    visitKind: payload.visitKind,
  };
  if (payload.visitBookingId) body.visitBookingId = payload.visitBookingId;
  const token = await resolveApiAccessToken();
  if (token) body.access_token = token;
  if (
    payload.driverLat != null &&
    payload.driverLng != null &&
    Number.isFinite(payload.driverLat) &&
    Number.isFinite(payload.driverLng)
  ) {
    body.driverLat = payload.driverLat;
    body.driverLng = payload.driverLng;
  }
  return apiPost(`/api/rides/${rideId}/arrive`, body);
}

export async function setRideAwaitingStopConfirmation(rideId: string, awaiting: boolean) {
  const token = await resolveApiAccessToken({ forceRefresh: true });
  return apiPost(`/api/rides/${rideId}/set-awaiting-confirmation`, {
    awaiting,
    ...(token ? { access_token: token } : {}),
  });
}

export async function confirmRideBookingPayment(rideId: string, bookingId: string) {
  return apiPost(`/api/rides/${rideId}/confirm-payment`, { bookingId });
}

export async function saveExtraStops(
  rideId: string,
  stops: Array<{ lat: number; lng: number; label?: string | null; order: number }>
) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return apiPost(`/api/rides/${rideId}/extra-stops`, { stops, access_token: token });
}
