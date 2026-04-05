/**
 * Configuración del motor de ruteo (API compatible con OSRM `route/v1/driving/...`).
 *
 * Causa raíz de fallos en producción: `https://router.project-osrm.org` es un **servicio de demostración**
 * sin SLA, colas, 504 y throttling impredecibles. No es arquitectura válida para una app real.
 *
 * Solución de fondo: en Vercel (y cualquier entorno productivo) definir `OSRM_BASE_URL` apuntando a:
 * - instancia OSRM/Valhalla propia (VM, Fly.io, k8s, etc.) con mapa de la región, o
 * - proveedor comercial que exponga el mismo esquema de URL, o
 * - otro backend de direcciones (p. ej. Google Directions / Mapbox) detrás de un adaptador en Next
 *   (cambio de contrato; hoy estos handlers asumen respuesta OSRM).
 */
const DEMO_OSRM_BASE = 'https://router.project-osrm.org';

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

export function getOsrmBaseUrl(): string {
  const fromEnv = process.env.OSRM_BASE_URL?.trim();
  if (fromEnv) return trimTrailingSlashes(fromEnv);
  return DEMO_OSRM_BASE;
}

/** Tiempo máximo de espera al motor upstream (una petición `fetch` a OSRM). */
export function getOsrmRequestTimeoutMs(): number {
  const n = Number(process.env.OSRM_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 3_000 && n <= 60_000) return Math.floor(n);
  return 12_000;
}
