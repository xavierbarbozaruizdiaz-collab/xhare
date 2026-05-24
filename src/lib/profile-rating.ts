/** Ventana usada en DB para calcular rating_average (últimas N calificaciones). */
export const PROFILE_RATING_WINDOW = 100;

export const DEFAULT_RATING_STARS = 5;

/**
 * Calificación visible en UI.
 * - 0–99 calificaciones: siempre 5.0 (valor inicial hasta acumular 100).
 * - 100+: media de las últimas 100 (rating_average en perfil).
 */
export function formatProfileRatingStars(
  ratingAverage: number | null | undefined,
  ratingCount: number | null | undefined
): string {
  const count = Math.max(0, Number(ratingCount ?? 0));
  if (count < PROFILE_RATING_WINDOW) {
    return DEFAULT_RATING_STARS.toFixed(1);
  }
  const avg = Number(ratingAverage ?? 0);
  if (!Number.isFinite(avg) || avg <= 0) {
    return DEFAULT_RATING_STARS.toFixed(1);
  }
  return avg.toFixed(1);
}

export function formatProfileRatingLabel(
  ratingAverage: number | null | undefined,
  ratingCount: number | null | undefined
): string {
  return formatProfileRatingStars(ratingAverage, ratingCount);
}
