/** Ventana usada en DB para calcular rating_average (últimas N calificaciones). */
export const PROFILE_RATING_WINDOW = 100;

export const DEFAULT_RATING_STARS = 5;

/** Texto de calificación en UI: evita mostrar "0.0★" cuando no hay calificaciones. */
export function formatProfileRatingStars(
  ratingAverage: number | null | undefined,
  ratingCount: number | null | undefined
): string | null {
  const count = Math.max(0, Number(ratingCount ?? 0));
  if (count <= 0) return null;
  if (count < PROFILE_RATING_WINDOW) {
    return DEFAULT_RATING_STARS.toFixed(1);
  }
  const avg = Number(ratingAverage ?? 0);
  if (!Number.isFinite(avg) || avg <= 0) return null;
  return avg.toFixed(1);
}

export function formatProfileRatingLabel(
  ratingAverage: number | null | undefined,
  ratingCount: number | null | undefined,
  emptyLabel = 'Nuevo'
): string {
  const stars = formatProfileRatingStars(ratingAverage, ratingCount);
  return stars ?? emptyLabel;
}
