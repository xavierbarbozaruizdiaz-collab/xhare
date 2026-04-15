import { NextRequest, NextResponse } from 'next/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-execute';

type Body = { mode?: 'both' | 'classified' | 'geo' };

function baseUrlFromRequest(request: NextRequest): string {
  const host = request.headers.get('host');
  if (!host) return 'http://localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function forwardPost(
  request: NextRequest,
  path: string
): Promise<{ path: string; status: number; body: unknown; text: string }> {
  const base = baseUrlFromRequest(request);
  const url = `${base}${path}`;
  const cookie = request.headers.get('cookie') ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (authorization) headers.Authorization = authorization;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    cache: 'no-store',
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  return { path, status: res.status, body, text };
}

/**
 * POST /api/admin/demand-grouping/execute
 * body: { mode: "both" | "classified" | "geo" }
 * Reenvía la sesión admin al mismo host: ejecuta los endpoints existentes (sin duplicar lógica).
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (req, _user) => {
    try {
      let body: Body = {};
      try {
        body = (await req.json()) as Body;
      } catch {
        body = {};
      }
      const mode = body.mode === 'classified' || body.mode === 'geo' ? body.mode : 'both';

      const steps: Array<{ path: string; status: number; body: unknown }> = [];

      if (mode === 'both' || mode === 'classified') {
        steps.push(await forwardPost(req, '/api/demand-routes/auto-group-classified'));
      }
      if (mode === 'both' || mode === 'geo') {
        steps.push(await forwardPost(req, '/api/demand-routes/sync'));
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        mode,
        steps,
        hint:
          'Si ves 401, la sesión expiró: recargá el admin o cerrá sesión y volvé a entrar. Los endpoints exigen usuario admin o conductor (mismo criterio que antes).',
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
