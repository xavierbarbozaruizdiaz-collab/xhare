import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';

export const DRIVER_DEBT_LIMIT_FALLBACK = 50000;

export function normalizeDriverDebtLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : DRIVER_DEBT_LIMIT_FALLBACK;
}

/** Límite default desde pricing_settings activo (Billing / Pricing). */
export async function fetchActiveDriverDebtLimitDefault(
  client: SupabaseClient = supabase
): Promise<number> {
  const { data, error } = await client
    .from('pricing_settings')
    .select('driver_debt_limit_default')
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return DRIVER_DEBT_LIMIT_FALLBACK;
  return normalizeDriverDebtLimit(
    (data as { driver_debt_limit_default?: number }).driver_debt_limit_default
  );
}

/**
 * Propaga el límite default a todas las filas driver_accounts y recalcula suspensión por deuda.
 */
export async function syncAllDriverAccountDebtLimits(
  client: SupabaseClient,
  limitPyg: number
): Promise<{ updated: number; error: string | null }> {
  const limit = normalizeDriverDebtLimit(limitPyg);
  const { data: accounts, error: selErr } = await client.from('driver_accounts').select('driver_id, debt_pyg');
  if (selErr) return { updated: 0, error: selErr.message };

  let updated = 0;
  for (const acc of accounts ?? []) {
    const debt = Number(acc.debt_pyg ?? 0);
    const status = debt > limit ? 'suspended' : 'active';
    const { error } = await client
      .from('driver_accounts')
      .update({
        debt_limit_pyg: limit,
        account_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('driver_id', acc.driver_id);
    if (error) return { updated, error: error.message };
    updated += 1;
  }
  return { updated, error: null };
}
