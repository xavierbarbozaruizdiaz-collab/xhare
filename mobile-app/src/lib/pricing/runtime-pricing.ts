/**
 * Pricing from DB (pricing_settings active). Same logic as web for segment fare.
 */
import { supabase } from '../../backend/supabase';

export interface PricingSettingsRow {
  id: string;
  min_fare_100: number;
  pyg_per_km_100: number;
  discount_percent: number;
  round_to: number;
  block_size: number;
  block_multiplier: number;
  is_active: boolean;
}

export interface EffectivePricing {
  minFarePyg: number;
  pygPerKm: number;
  roundTo: number;
  blockSize: number;
  blockMultiplier: number;
  pricingSettingsId: string | null;
}

const CACHE_MS = 60_000;
let cached: PricingSettingsRow | null | undefined = undefined;
let cachedAt = 0;

export async function loadActivePricingSettings(): Promise<PricingSettingsRow | null> {
  const now = Date.now();
  if (cached !== undefined && now - cachedAt < CACHE_MS) {
    return cached ?? null;
  }
  const { data, error } = await supabase
    .from('pricing_settings')
    .select('id, min_fare_100, pyg_per_km_100, discount_percent, round_to, block_size, block_multiplier, is_active')
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

export function computeEffectivePricing(settings: PricingSettingsRow): EffectivePricing {
  const d = 1 - (settings.discount_percent ?? 0) / 100;
  const roundTo = Math.max(1, settings.round_to ?? 100);
  const minFare = Math.round((settings.min_fare_100 * d) / roundTo) * roundTo;
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
