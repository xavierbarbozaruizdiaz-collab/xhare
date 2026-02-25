/**
 * Rate limiter en memoria. Para múltiples instancias (Vercel serverless) usar Redis/Upstash.
 * Uso: checkRateLimit(key, windowMs, maxPerWindow) -> true si permitido, false si excedido.
 */
const store = new Map<string, { count: number; resetAt: number }>();

const CLEAN_INTERVAL_MS = 60_000;
let cleanTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanTimer) return;
  cleanTimer = setInterval(() => {
    const now = Date.now();
    Array.from(store.entries()).forEach(([k, v]) => {
      if (v.resetAt < now) store.delete(k);
    });
  }, CLEAN_INTERVAL_MS);
}

/** Returns true if allowed, false if rate limited. */
export function checkRateLimit(
  key: string,
  windowMs: number,
  maxPerWindow: number
): boolean {
  ensureCleanup();
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxPerWindow) return false;
  entry.count++;
  return true;
}

/** Key from request: IP or user id for authenticated routes. */
export function getClientId(request: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}
