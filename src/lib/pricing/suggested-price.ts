/**
 * Precio sugerido por asiento (estilo BlaBlaCar / Poparide).
 *
 * Referencias:
 * - BlaBlaCar: aportación recomendada ~0,05 EUR/km por asiento (cubre combustible, desgaste, mantenimiento).
 *   El conductor puede ajustar dentro de márgenes; hay techo máximo.
 * - Poparide: máximo 18 cent CAD/km; típico 12–15 cent/km; considera combustible y costos operativos.
 *
 * Fórmula: precio_por_asiento = distancia_km × aportación_por_km
 * La aportación por km es por asiento (lo que paga cada pasajero por kilómetro del trayecto).
 */

export const PRICING = {
  /** Aportación sugerida por kilómetro por asiento (en la moneda indicada). Ajustar según país/combustible. */
  pricePerKmPerSeat: 600,
  /** Moneda para mostrar en la UI (ej: PYG, ARS, EUR). */
  currency: 'PYG' as const,
  /** Nombre corto para etiquetas (ej: "Guaraníes", "pesos"). */
  currencyLabel: 'Guaraníes',
  /** Multiplicador máximo respecto al sugerido (ej: 1.2 = no más del 20 % por encima). 0 = sin tope. */
  maxMultiplier: 1.2,
  /** Redondear precio sugerido a múltiplos de este valor (ej: 500 en PYG). 0 = sin redondeo. */
  roundToNearest: 500,
} as const;

/**
 * Calcula el precio sugerido por asiento para un trayecto según la distancia.
 * Respeta redondeo configurado (roundToNearest).
 */
export function getSuggestedPricePerSeat(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  const raw = distanceKm * PRICING.pricePerKmPerSeat;
  const { roundToNearest } = PRICING;
  if (!roundToNearest) return Math.round(raw);
  return Math.round(raw / roundToNearest) * roundToNearest;
}

/**
 * Precio máximo recomendado por asiento (opcional, para validación en el formulario).
 */
export function getMaxPricePerSeat(distanceKm: number): number | null {
  if (PRICING.maxMultiplier <= 0) return null;
  const suggested = getSuggestedPricePerSeat(distanceKm);
  return Math.round(suggested * PRICING.maxMultiplier);
}
