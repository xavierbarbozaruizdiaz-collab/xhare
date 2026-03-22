/**
 * Segment fare: base from distance, total from base + seats. Aligned with web.
 */
import type { EffectivePricing } from './runtime-pricing';

export const MIN_FARE_PYG = 7140;
export const PYG_PER_KM = 2780;

export function baseFareFromDistanceKmWithPricing(distanceKm: number, pricing: EffectivePricing): number {
  const raw = Math.max(pricing.minFarePyg, distanceKm * pricing.pygPerKm);
  return Math.round(raw / pricing.roundTo) * pricing.roundTo;
}

export function totalFareFromBaseAndSeatsWithPricing(
  baseFare: number,
  seatCount: number,
  pricing: EffectivePricing
): number {
  if (seatCount <= 0) return 0;
  if (seatCount === 1) return baseFare;
  const blockSize = pricing.blockSize ?? 4;
  const mult = pricing.blockMultiplier ?? 1.5;
  const roundTo = pricing.roundTo ?? 100;
  const blockFare = Math.round((baseFare * mult) / roundTo) * roundTo;
  const blocks = Math.ceil(seatCount / blockSize);
  const total = blocks * blockFare;
  return Math.round(total / roundTo) * roundTo;
}
