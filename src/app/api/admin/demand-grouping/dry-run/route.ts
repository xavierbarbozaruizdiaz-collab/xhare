import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-dry-run';

/**
 * POST /api/admin/demand-grouping/dry-run
 * Dry-run HEX-only.
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const service = createServiceClient();
      let reqBody: Record<string, unknown> = {};
      try {
        reqBody = (await request.json()) as Record<string, unknown>;
      } catch {
        reqBody = {};
      }
      const maxSeats = Number.isFinite(reqBody.maxSeats as number) ? Math.max(1, Math.floor(reqBody.maxSeats as number)) : 15;

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        params: { maxSeats },
        message: 'Dry-run de corridor/classified y geo_sync deshabilitado. Usar ejecución HEX-only.',
        removed: ['corridor_bucket/classified', 'geo_sync'],
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Error interno' },
        { status: 500 }
      );
    }
  });
}
