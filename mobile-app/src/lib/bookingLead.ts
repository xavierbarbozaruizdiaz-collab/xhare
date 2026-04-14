/** Anticipación mínima para salida/recogida (hora local del dispositivo). */
export const MIN_BOOKING_LEAD_MS = 4 * 60 * 60 * 1000;

export function parseLocalYmdHm(dateYmd: string, hm: string): Date | null {
  const [yy, mm, dd] = dateYmd.trim().split('-').map((x) => parseInt(x, 10));
  const mt = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!mt) return null;
  const h = parseInt(mt[1], 10);
  const mi = parseInt(mt[2], 10);
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) return null;
  return new Date(yy, mm - 1, dd, h, mi, 0, 0);
}

/** `pickupHm` en `dateYmd` (calendario local) debe ser ≥ ahora + `leadMs`. */
export function isPickupAtLeastLeadAhead(
  dateYmd: string,
  pickupHm: string,
  leadMs: number = MIN_BOOKING_LEAD_MS
): boolean {
  const t = parseLocalYmdHm(dateYmd, pickupHm);
  if (!t) return false;
  return t.getTime() >= Date.now() + leadMs;
}

/** Suma días a `YYYY-MM-DD` en calendario local (mediodía para evitar bordes). */
export function addDaysToYmd(dateYmd: string, days: number): string {
  const t = parseLocalYmdHm(dateYmd, '12:00');
  if (!t) return dateYmd.trim();
  const dt = new Date(t.getTime());
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
