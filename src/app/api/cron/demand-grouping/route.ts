import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { drainDriverDemandPassengerLeftPushQueue } from '@/lib/push/sendDriverDemandPassengerLeftPush';
import {
  normalizeDemandGroupingParams,
  runDemandGroupingPipeline,
  type DemandGroupingMode,
} from '@/lib/demand-grouping-pipeline';

export const dynamic = 'force-dynamic';

function cronAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  const syncSecret = process.env.DEMAND_ROUTES_SYNC_SECRET?.trim();
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  if (cronSecret && token === cronSecret) return true;
  if (syncSecret && token === syncSecret) return true;
  return false;
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const syncSecret = process.env.DEMAND_ROUTES_SYNC_SECRET?.trim();
  if (!cronSecret && !syncSecret) {
    return NextResponse.json(
      {
        error:
          'Falta CRON_SECRET o DEMAND_ROUTES_SYNC_SECRET: configurá al menos uno en Vercel para autenticar el cron.',
      },
      { status: 503 }
    );
  }

  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  if (request.method === 'POST') {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const mode: DemandGroupingMode =
    body.mode === 'classified' || body.mode === 'geo' ? (body.mode as DemandGroupingMode) : 'both';
  const params = normalizeDemandGroupingParams({
    maxSeats: body.maxSeats as number | undefined,
    minScore: body.minScore as number | undefined,
    maxOriginKm: body.maxOriginKm as number | undefined,
    maxDestKm: body.maxDestKm as number | undefined,
  });

  const service = createServiceClient();
  try {
    await drainDriverDemandPassengerLeftPushQueue(service);
  } catch (e) {
    console.error('[cron/demand-grouping] drainDriverDemandPassengerLeftPushQueue', e);
  }
  const { steps } = await runDemandGroupingPipeline(service, mode, params);
  const anyFail = steps.some((s) => s.status >= 400);

  return NextResponse.json(
    {
      ok: !anyFail,
      ranAt: new Date().toISOString(),
      path: '/api/cron/demand-grouping',
      mode,
      params,
      steps,
    },
    { status: anyFail ? 500 : 200 }
  );
}

/** Vercel Cron invoca GET con `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  return handle(request);
}

/** POST permite body `{ mode, maxSeats, ... }` (mismo contrato que admin execute). */
export async function POST(request: NextRequest) {
  return handle(request);
}
