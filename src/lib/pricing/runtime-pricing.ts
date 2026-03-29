/**
 * Pricing desde DB (pricing_settings activo). Cache corto para no golpear Supabase en cada cálculo.
 * Fallback: si no hay activo, la app usa constantes de segment-fare.ts.
 */

import { supabase } from '@/lib/supabase/client';

export interface PricingSettingsRow {
  id: string;
  min_fare_100: number;
  pyg_per_km_100: number;
  discount_percent: number;
  round_to: number;
  block_size: number;
  block_multiplier: number;
  /** Piso PYG para tarifa mínima efectiva (tras descuento y redondeo). */
  min_fare_floor_pyg?: number;
  driver_fee_percent_of_collected?: number;
  driver_debt_limit_default?: number;
  is_active: boolean;
  created_at: string;
}

export interface EffectivePricing {
  minFarePyg: number;
  pygPerKm: number;
  roundTo: number;
  blockSize: number;
  blockMultiplier: number;
  /** IDs para snapshot (null si fallback) */
  pricingSettingsId: string | null;
}

const CACHE_MS = 60_000;
let cached: PricingSettingsRow | null | undefined = undefined;
let cachedAt = 0;

/**
 * Lee el pricing_settings activo. Cache 60s en memoria.
 * Retorna null si no hay fila activa (usar fallback en segment-fare).
 */
export async function loadActivePricingSettings(): Promise<PricingSettingsRow | null> {
  const now = Date.now();
  if (cached !== undefined && now - cachedAt < CACHE_MS) {
    return cached ?? null;
  }
  const { data, error } = await supabase
    .from('pricing_settings')
    .select(
      'id, min_fare_100, pyg_per_km_100, discount_percent, round_to, block_size, block_multiplier, min_fare_floor_pyg, driver_fee_percent_of_collected, driver_debt_limit_default, is_active, created_at'
    )
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    cached = null;
    cachedAt = now;
    return null;
  }
  cached = data as PricingSettingsRow;
  cachedAt = now;
  return cached;
}

/**
 * Aplica discount_percent a valores 100% y devuelve efectivos para cálculo.
 * effective = 100% * (1 - discount_percent/100), redondeado a round_to.
 */
export function computeEffectivePricing(settings: PricingSettingsRow): EffectivePricing {
  const d = 1 - (settings.discount_percent ?? 0) / 100;
  const roundTo = Math.max(1, settings.round_to ?? 100);
  const computedMin = Math.round((settings.min_fare_100 * d) / roundTo) * roundTo;
  const floor = Math.max(0, settings.min_fare_floor_pyg ?? 10000);
  const minFare = Math.max(floor, computedMin);
  const pygPerKm = Math.round((settings.pyg_per_km_100 * d) / roundTo) * roundTo;
  return {
    minFarePyg: minFare,
    pygPerKm,
    roundTo,
    blockSize: settings.block_size ?? 4,
    blockMultiplier: settings.block_multiplier ?? 1.5,
    pricingSettingsId: settings.id,
  };
}

/**
 * Invalida el cache (útil tras actualizar settings en admin).
 */
export function invalidatePricingCache(): void {
  cached = undefined;
  cachedAt = 0;
}
