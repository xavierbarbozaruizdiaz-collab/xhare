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
 * Valida JWT o sesión, comprueba rol admin en profiles.
 * Si todo es correcto llama a handler(request, user); si no, responde 401/403.
 */
export async function withAdminAuth(
  request: NextRequest,
  handler: (req: NextRequest, user: AdminUser) => Promise<NextResponse>
): Promise<NextResponse> {
  const jwt = getJwtFromRequest(request);
  const supabaseAuth = createServerClient(request);

  let user: AdminUser | null = null;
  let authError: Error | null = null;

  if (jwt) {
    const res = await supabaseAuth.auth.getUser(jwt);
    user = res.data.user ?? null;
    authError = res.error ?? null;
  }
  if (!user) {
    const res = await supabaseAuth.auth.getUser();
    user = res.data.user ?? null;
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
