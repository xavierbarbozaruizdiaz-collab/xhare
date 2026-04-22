import type { SupabaseClient } from '@supabase/supabase-js';
import { runHexGroupingGooglePass } from '@/lib/demand-hex-google-optimize';
import { runDemandRoutesGeoSync } from '@/lib/demand-routes-geo-sync';

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
 * 1) Agrupa por super-hex (v3) + optimización Google fase pickups (degradación FIFO si falla).
 * 2) Agrupa classified (v2 con score; fallback v1 si falla el RPC v2).
 * 3) Sync geo para pending unclassified (misma lógica que POST /api/demand-routes/sync).
 */
export async function runDemandGroupingPipeline(
  service: SupabaseClient,
  mode: DemandGroupingMode,
  params: DemandGroupingParams
): Promise<{ steps: DemandGroupingStep[] }> {
  const steps: DemandGroupingStep[] = [];
  const { maxSeats, minScore, maxOriginKm, maxDestKm } = params;

  if (mode === 'both' || mode === 'classified') {
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

  if (mode === 'both' || mode === 'classified') {
    const { data, error } = await service.rpc('auto_group_classified_trip_requests_v2', {
      p_max_seats: maxSeats,
      p_min_score: minScore,
      p_max_origin_km: maxOriginKm,
      p_max_dest_km: maxDestKm,
    });
    if (error) {
      const { data: fbData, error: fbErr } = await service.rpc('auto_group_classified_trip_requests', {
        p_max_seats: maxSeats,
      });
      if (fbErr) {
        steps.push({
          name: 'auto_group_classified_trip_requests_v2',
          status: 500,
          body: {
            error: error.message,
            code: error.code,
            fallback_error: fbErr.message,
            hint: 'Revisá migración 075 (motor v2) y RPC v1.',
          },
        });
      } else {
        steps.push({
          name: 'auto_group_classified_trip_requests (fallback_v1)',
          status: 200,
          body: fbData ?? { ok: true, fallback: true },
        });
      }
    } else {
      steps.push({
        name: 'auto_group_classified_trip_requests_v2',
        status: 200,
        body: data ?? { ok: true },
      });
    }
  }

  if (mode === 'both' || mode === 'geo') {
    const geo = await runDemandRoutesGeoSync(service);
    if (!geo.ok) {
      steps.push({
        name: 'demand_routes_geo_sync',
        status: 500,
        body: { error: geo.error },
      });
    } else {
      steps.push({
        name: 'demand_routes_geo_sync',
        status: 200,
        body: {
          ok: true,
          processed: geo.processed,
          addedToExisting: geo.addedToExisting,
          newGroupsCreated: geo.newGroupsCreated,
          ...(geo.message ? { message: geo.message } : {}),
        },
      });
    }
  }

  return { steps };
}
