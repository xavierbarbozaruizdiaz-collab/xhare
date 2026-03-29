/**
 * Origen para abrir Maps/Waze desde la app.
 *
 * Contrato: la promesa termina en un tiempo acotado (no bloquear la UI si el GPS no entrega fix).
 * Estrategia: en paralelo, última posición conocida (rápida) y un intento de fix fresco con timeout;
 * se prefiere el fresco si llega a tiempo; si no, la última conocida válida; si no hay ninguna, undefined
 * y la app de mapas usa su propia ubicación.
 */
import * as Location from 'expo-location';

/** Tiempo máximo de espera al fix “en vivo” antes de seguir con última conocida / sin origen. */
export const EXTERNAL_NAV_FRESH_FIX_TIMEOUT_MS = 8_000;

/** Edad máxima de la caché del SO para considerar `getLastKnownPositionAsync`. */
export const EXTERNAL_NAV_LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1_000;

function toPoint(loc: Location.LocationObject | null | undefined): { lat: number; lng: number } | undefined {
  if (!loc?.coords) return undefined;
  const lat = loc.coords.latitude;
  const lng = loc.coords.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

export async function getOriginForExternalNavigation(options?: {
  freshFixTimeoutMs?: number;
  lastKnownMaxAgeMs?: number;
}): Promise<{ lat: number; lng: number } | undefined> {
  const freshMs = options?.freshFixTimeoutMs ?? EXTERNAL_NAV_FRESH_FIX_TIMEOUT_MS;
  const maxAge = options?.lastKnownMaxAgeMs ?? EXTERNAL_NAV_LAST_KNOWN_MAX_AGE_MS;

  const timeoutWins = new Promise<null>((resolve) => setTimeout(() => resolve(null), freshMs));

  const lastKnownP = Location.getLastKnownPositionAsync({ maxAge }).catch(() => null);

  const freshP = Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    timeoutWins,
  ]).catch(() => null);

  const [lastKnown, raced] = await Promise.all([lastKnownP, freshP]);

  const fresh = toPoint(raced && typeof raced === 'object' && 'coords' in raced ? raced : null);
  if (fresh) return fresh;

  return toPoint(lastKnown);
}
