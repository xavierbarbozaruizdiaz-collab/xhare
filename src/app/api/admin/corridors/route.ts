import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors';
const ADMIN_CORRIDORS_WINDOW_MS = 60_000;
const ADMIN_CORRIDORS_MAX_PER_WINDOW = 50;

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
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors:${clientId}`, ADMIN_CORRIDORS_WINDOW_MS, ADMIN_CORRIDORS_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
      const service = createServiceClient();
      const { data, error } = await service
        .from('corridors')
        .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active, created_at')
        .order('sort_priority', { ascending: false })
        .order('name', { ascending: true });

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: 'No se pudieron obtener los corredores.' }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ corridors: (data ?? []) as AdminCorridorRow[] });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
