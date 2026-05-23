import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import {
  corridorZoneTemplateForDepartment,
  emptyZoneFromBbox,
  isCorridorImportDepartmentId,
  slugifyCorridorSlug,
} from '@/lib/admin/corridor-city-import';

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

/**
 * POST /api/admin/corridors
 * Body: { department: CorridorImportDepartmentId, name?: string, slug?: string }
 * — crea fila vacía; sin name usa plantilla del departamento (`{department}_metro_local`).
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors-create:${clientId}`, ADMIN_CORRIDORS_WINDOW_MS, 20)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }

      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
      }
      const body = raw as { department?: unknown; name?: unknown; slug?: unknown };
      const department = body.department;
      if (!isCorridorImportDepartmentId(department)) {
        return NextResponse.json(
          { error: 'department inválido (elegí un departamento de Paraguay en el listado del admin)' },
          { status: 400 }
        );
      }

      const t = corridorZoneTemplateForDepartment(department);
      if (!t) {
        return NextResponse.json({ error: 'Departamento sin plantilla de zona' }, { status: 400 });
      }
      const zone = emptyZoneFromBbox(t.bbox);
      const service = createServiceClient();

      const customName = typeof body.name === 'string' ? body.name.trim() : '';
      const customSlugRaw = typeof body.slug === 'string' ? body.slug.trim() : '';
      const displayName = customName.length >= 2 ? customName.slice(0, 120) : t.name;
      const slug =
        customSlugRaw.length >= 2
          ? slugifyCorridorSlug(customSlugRaw)
          : customName.length >= 2
            ? slugifyCorridorSlug(customName)
            : t.slug;
      if (!slug || slug.length < 2) {
        return NextResponse.json({ error: 'slug inválido (mínimo 2 caracteres)' }, { status: 400 });
      }

      const { data: existing } = await service.from('corridors').select('id, slug').eq('slug', slug).maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: `Ya existe una zona con slug "${slug}". Elegí otro nombre o slug.` },
          { status: 409 }
        );
      }

      const { data, error } = await service
        .from('corridors')
        .insert({
          name: displayName,
          slug,
          origin_zone: zone,
          destination_zone: zone,
          sort_priority: t.sort_priority,
          is_active: true,
        })
        .select('id, name, slug, origin_zone, destination_zone, sort_priority, is_active, created_at')
        .single();

      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: 'No se pudo crear la zona.' }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ corridor: data as AdminCorridorRow });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
