import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-user-emails';
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const MAX_IDS = 500;
const LIST_USERS_PER_PAGE = 1000;
const LIST_USERS_MAX_PAGES = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Devuelve el email (auth.users) de los usuarios pedidos.
 * El email no está en `profiles`; solo el service role puede leerlo,
 * por eso el admin lo obtiene vía esta API y no con el cliente anon.
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-user-emails:${clientId}`, WINDOW_MS, MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }

      const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
      const rawIds = Array.isArray(body.ids) ? body.ids : [];
      const ids = Array.from(
        new Set(
          rawIds
            .map((v) => String(v ?? '').trim())
            .filter((v) => UUID_RE.test(v))
        )
      ).slice(0, MAX_IDS);

      if (ids.length === 0) {
        return NextResponse.json({ emails: {} });
      }

      const service = createServiceClient();
      const wanted = new Set(ids);
      const emails: Record<string, string | null> = {};

      for (let page = 1; page <= LIST_USERS_MAX_PAGES && wanted.size > 0; page++) {
        const { data, error } = await service.auth.admin.listUsers({
          page,
          perPage: LIST_USERS_PER_PAGE,
        });
        if (error) {
          logBlockError(BLOCK, error.message, error);
          return NextResponse.json(
            { error: 'No se pudieron obtener los emails.' },
            { status: 500 }
          );
        }
        const users = data?.users ?? [];
        for (const u of users) {
          const uid = String(u.id);
          if (wanted.has(uid)) {
            emails[uid] = u.email ?? null;
            wanted.delete(uid);
          }
        }
        if (users.length < LIST_USERS_PER_PAGE) break;
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ emails });
    } catch (err) {
      logBlockError(BLOCK, err instanceof Error ? err.message : 'Unknown error', err);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
