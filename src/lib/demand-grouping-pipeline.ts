import type { SupabaseClient } from '@supabase/supabase-js';
import { runHexGroupingGooglePass } from '@/lib/demand-hex-google-optimize';

function parseHexGroupIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const raw = (data as Record<string, unknown>).group_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export type DemandGroupingStep = { name: string; status: number; body: unknown };

export type DemandGroupingMode = 'both' | 'classified' | 'geo';

export type DemandGroupingParams = {
  maxSeats: number;
  minScore: number;
  maxOriginKm: number;
  maxDestKm: number;
};

/** Mismos defaults que POST /api/admin/demand-grouping/execute. */
export function normalizeDemandGroupingParams(body: {
  maxSeats?: number;
  minScore?: number;
  maxOriginKm?: number;
  maxDestKm?: number;
}): DemandGroupingParams {
  return {
    maxSeats: Number.isFinite(body.maxSeats) ? Math.max(1, Math.floor(body.maxSeats as number)) : 15,
    minScore: Number.isFinite(body.minScore) ? Math.max(0, Math.min(0.99, Number(body.minScore))) : 0.55,
    maxOriginKm: Number.isFinite(body.maxOriginKm) ? Math.max(0.05, Number(body.maxOriginKm)) : 8,
    maxDestKm: Number.isFinite(body.maxDestKm) ? Math.max(0.05, Number(body.maxDestKm)) : 8,
  };
}

/**
 * Pipeline actual: solo HEX.
 * Los motores corridor/classified y geo_sync quedan deshabilitados en runtime.
 */
export async function runDemandGroupingPipeline(
  service: SupabaseClient,
  mode: DemandGroupingMode,
  params: DemandGroupingParams
): Promise<{ steps: DemandGroupingStep[] }> {
  const steps: DemandGroupingStep[] = [];
  const { maxSeats } = params;

  if (mode === 'both' || mode === 'classified' || mode === 'geo') {
    const { data: hexData, error: hexErr } = await service.rpc('auto_group_hex_trip_requests_v3', {
      p_max_seats: maxSeats,
    });
    if (hexErr) {
      steps.push({
        name: 'auto_group_hex_trip_requests_v3',
        status: 500,
        body: {
          error: hexErr.message,
          code: hexErr.code,
          hint: 'Revisá migración 076 (hex_bucket + RPC v3).',
        },
      });
    } else {
      steps.push({
        name: 'auto_group_hex_trip_requests_v3',
        status: 200,
        body: hexData ?? { ok: true },
      });
      const groupIds = parseHexGroupIds(hexData);
      if (groupIds.length > 0) {
        const opt = await runHexGroupingGooglePass(service, groupIds);
        steps.push({
          name: 'hex_google_pdp',
          status: 200,
          body: {
            ok: opt.ok,
            results: opt.results,
          },
        });
      }
    }
  }

  steps.push({
    name: 'legacy_engines_disabled',
    status: 200,
    body: {
      ok: true,
      disabled: ['corridor_bucket', 'classified', 'geo_sync'],
      note: 'Pipeline ejecutado en modo HEX-only.',
      requested_mode: mode,
    },
  });

  return { steps };
}
