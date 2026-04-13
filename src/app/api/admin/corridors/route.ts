import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors';

export type AdminCorridorRow = {
  id: string;
  name: string;
  slug: string;
  origin_zone: Record<string, unknown>;
  destination_zone: Record<string, unknown>;
  sort_priority: number;
  is_active: boolean;
  created_at: string;
};

/**
 * GET /api/admin/corridors
 * Lista corredores MVP (zonas bbox) usados en clasificación y agrupación de demanda.
 */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const service = createServiceClient();
      const { data, error } = await service
        .from('corridors')
        .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active, created_at')
        .order('sort_priority', { ascending: false })
        .order('name', { ascending: true });

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ corridors: (data ?? []) as AdminCorridorRow[] });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
