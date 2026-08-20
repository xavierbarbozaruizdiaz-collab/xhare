import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';

export type AdminUser = { id: string };

function getJwtFromRequest(request: NextRequest): string | null {
  const auth =
    request.headers.get('authorization') ??
    request.headers.get('Authorization') ??
    '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const custom = request.headers.get('x-admin-token');
  return custom?.trim() ?? null;
}

/**
 * Valida el JWT del header sin reutilizar createServerClient(request) con ese mismo header:
 * mezclar Bearer global + getUser(jwt) en servidor fallaba en algunos despliegues (401 Unauthorized).
 */
async function getUserFromBearerJwt(jwt: string): Promise<{
  user: AdminUser | null;
  error: Error | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anon) {
    return { user: null, error: new Error('Missing NEXT_PUBLIC_SUPABASE_URL or ANON_KEY') };
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(jwt);
  return {
    user: data.user ? { id: data.user.id } : null,
    error: error ?? null,
  };
}

/**
 * Valida JWT o sesión, comprueba rol admin en profiles.
 * Si todo es correcto llama a handler(request, user); si no, responde 401/403.
 */
export async function withAdminAuth(
  request: NextRequest,
  handler: (req: NextRequest, user: AdminUser) => Promise<NextResponse>
): Promise<NextResponse> {
  const jwt = getJwtFromRequest(request);

  let user: AdminUser | null = null;
  let authError: Error | null = null;

  if (jwt) {
    const res = await getUserFromBearerJwt(jwt);
    user = res.user;
    authError = res.error;
  }
  if (!user) {
    const supabaseAuth = createServerClient(request);
    const res = await supabaseAuth.auth.getUser();
    user = res.data.user ? { id: res.data.user.id } : null;
    authError = res.error ?? null;
  }

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return handler(request, user);
}

/** Devuelve el admin autenticado o null. No consume el body del request. */
export async function getAdminUserFromRequest(request: NextRequest): Promise<AdminUser | null> {
  const jwt = getJwtFromRequest(request);
  let user: AdminUser | null = null;
  if (jwt) {
    const res = await getUserFromBearerJwt(jwt);
    user = res.user;
  }
  if (!user) {
    const supabaseAuth = createServerClient(request);
    const res = await supabaseAuth.auth.getUser();
    user = res.data.user ? { id: res.data.user.id } : null;
  }
  if (!user) return null;
  const service = createServiceClient();
  const { data: profile } = await service.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return null;
  return user;
}

const DEV = process.env.NODE_ENV === 'development';

/** Logs seguros por bloque: nombre + mensaje corto. Sin PII/tokens/stack en producción. */
export function logBlockStart(blockName: string): void {
  console.log('[ADMIN_BLOCK_START]', blockName);
}

export function logBlockOk(blockName: string): void {
  console.log('[ADMIN_BLOCK_OK]', blockName);
}

export function logBlockError(blockName: string, shortMessage: string, err?: unknown): void {
  console.error('[ADMIN_BLOCK_ERROR]', blockName, shortMessage);
  if (DEV && err !== undefined) console.error(err);
}
