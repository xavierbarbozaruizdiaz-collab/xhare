import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-versions';
const ADMIN_CORRIDOR_VERSIONS_GET_WINDOW_MS = 60_000;
const ADMIN_CORRIDOR_VERSIONS_GET_MAX_PER_WINDOW = 40;
const ADMIN_CORRIDOR_VERSIONS_POST_WINDOW_MS = 60_000;
const ADMIN_CORRIDOR_VERSIONS_POST_MAX_PER_WINDOW = 15;

type CorrRow = {
  id: string;
  name: string;
  slug: string;
  origin_zone: Record<string, unknown>;
  destination_zone: Record<string, unknown>;
  sort_priority: number;
  is_active: boolean;
};

/** GET /api/admin/corridors/versions */
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors-versions-get:${clientId}`, ADMIN_CORRIDOR_VERSIONS_GET_WINDOW_MS, ADMIN_CORRIDOR_VERSIONS_GET_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
      const svc = createServiceClient();
      const { data, error } = await svc
        .from('admin_corridor_config_versions')
        .select('id, created_at, note, is_published')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: 'No se pudieron obtener las versiones de corredores.' }, { status: 400 });
      }
      logBlockOk(BLOCK);
      return NextResponse.json({ versions: data ?? [] });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

/** POST /api/admin/corridors/versions  body: { note?: string } */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors-versions-post:${clientId}`, ADMIN_CORRIDOR_VERSIONS_POST_WINDOW_MS, ADMIN_CORRIDOR_VERSIONS_POST_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
      let note = '';
      try {
        const raw = (await request.json()) as { note?: unknown };
        if (typeof raw.note === 'string') note = raw.note.slice(0, 500);
      } catch {
        /* empty body allowed */
      }

      const svc = createServiceClient();
      const { data: corridors, error: cErr } = await svc
        .from('corridors')
        .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active')
        .order('sort_priority', { ascending: false })
        .order('name', { ascending: true });
      if (cErr) {
        logBlockError(BLOCK, cErr.message, cErr);
        return NextResponse.json({ error: 'No se pudo leer la configuración de corredores.' }, { status: 400 });
      }

      const snap = (corridors ?? []) as CorrRow[];
      const { error: unpubErr } = await svc
        .from('admin_corridor_config_versions')
        .update({ is_published: false })
        .eq('is_published', true);
      if (unpubErr) {
        logBlockError(BLOCK, unpubErr.message, unpubErr);
        return NextResponse.json({ error: 'No se pudo actualizar la versión publicada anterior.' }, { status: 400 });
      }

      const { data: inserted, error: insErr } = await svc
        .from('admin_corridor_config_versions')
        .insert({
          created_by: user.id,
          note: note || null,
          is_published: true,
          corridors_snapshot: snap,
        })
        .select('id, created_at, note, is_published')
        .single();
      if (insErr) {
        logBlockError(BLOCK, insErr.message, insErr);
        return NextResponse.json({ error: 'No se pudo crear la nueva versión de corredores.' }, { status: 400 });
      }
      logBlockOk(BLOCK);
      return NextResponse.json({ version: inserted });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

