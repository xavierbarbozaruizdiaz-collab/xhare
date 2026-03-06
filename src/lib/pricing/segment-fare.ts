/**
 * Tarifa por tramo (recogida → descenso) al 60% de la app de referencia.
 * Referencia: 13.900 PYG / 3 km; mínimo 11.900 PYG / 2 km.
 * Fallback cuando no hay pricing_settings activo.
 */

import type { EffectivePricing } from './runtime-pricing';

export const MIN_FARE_PYG = 7140; // 60% de 11.900
export const PYG_PER_KM = 2780;   // 60% de (13.900 / 3)
const DEFAULT_ROUND = 100;
const DEFAULT_BLOCK_SIZE = 4;
const DEFAULT_BLOCK_MULTIPLIER = 1.5;

/** Precio base por 1 asiento según distancia del tramo (redondeado a 100). Mantener para compatibilidad. */
export function baseFareFromDistanceKm(distanceKm: number): number {
  const raw = Math.max(MIN_FARE_PYG, distanceKm * PYG_PER_KM);
  return Math.round(raw / DEFAULT_ROUND) * DEFAULT_ROUND;
}

/**
 * Total a cobrar según precio base (1 asiento) y cantidad de asientos.
 * Fórmula: N=1 → base; N≥2 → ceil(N/4) × (1,5 × base). Redondeado a 100 PYG.
 * Mantener para compatibilidad.
 */
export function totalFareFromBaseAndSeats(baseFare: number, seatCount: number): number {
  return totalFareFromBaseAndSeatsWithPricing(baseFare, seatCount, {
    minFarePyg: MIN_FARE_PYG,
    pygPerKm: PYG_PER_KM,
    roundTo: DEFAULT_ROUND,
    blockSize: DEFAULT_BLOCK_SIZE,
    blockMultiplier: DEFAULT_BLOCK_MULTIPLIER,
    pricingSettingsId: null,
  });
}

/** Precio base con pricing efectivo (DB). */
export function baseFareFromDistanceKmWithPricing(distanceKm: number, pricing: EffectivePricing): number {
  const raw = Math.max(pricing.minFarePyg, distanceKm * pricing.pygPerKm);
  return Math.round(raw / pricing.roundTo) * pricing.roundTo;
}

/**
 * Total a cobrar con pricing efectivo (block_size y block_multiplier desde pricing).
 */
export function totalFareFromBaseAndSeatsWithPricing(
  baseFare: number,
  seatCount: number,
  pricing: EffectivePricing
): number {
  if (seatCount <= 0) return 0;
  if (seatCount === 1) return baseFare;
  const blockSize = pricing.blockSize ?? DEFAULT_BLOCK_SIZE;
  const mult = pricing.blockMultiplier ?? DEFAULT_BLOCK_MULTIPLIER;
  const roundTo = pricing.roundTo ?? DEFAULT_ROUND;
  const blockFare = Math.round((baseFare * mult) / roundTo) * roundTo;
  const blocks = Math.ceil(seatCount / blockSize);
  const total = blocks * blockFare;
  return Math.round(total / roundTo) * roundTo;
}
