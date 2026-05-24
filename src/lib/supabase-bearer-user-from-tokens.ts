import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Bearer(s) a probar: header primero, luego `access_token` del JSON (sin duplicados).
 */
export function collectAccessTokenCandidates(request: NextRequest, body: unknown): string[] {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  const fromHeader = auth.replace(/^\s*Bearer\s+/i, '').trim();
  let fromBody = '';
  if (body && typeof body === 'object' && body !== null) {
    const v = (body as { access_token?: unknown }).access_token;
    if (typeof v === 'string') fromBody = v.trim();
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [fromHeader, fromBody]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Resuelve el usuario de Supabase Auth probando cada JWT con un cliente **nuevo** que solo lleva
 * ese Bearer en `global.headers` y `getUser()` sin argumentos — mismo patrón que
 * `POST /api/rides/[id]/arrive` y que `getUserFromBearerJwt` en `admin-auth.ts`.
 *
 * Evita el 401 al combinar `createServerClient(request)` (Bearer global fijo) con `getUser(jwt)`.
 * Respaldo: `service.auth.getUser(jwt)` como en `getAuth` (`api-auth.ts`) por si el anon falla.
 */
export async function resolveUserFromAccessTokenCandidates(tokens: string[]): Promise<User | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const seen = new Set<string>();
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);

    const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${t}` } },
    });
    const {
      data: { user },
      error,
    } = await jwtClient.auth.getUser();
    if (!error && user?.id) return user;

    try {
      const service = createServiceClient();
      const svc = await service.auth.getUser(t);
      if (svc.data.user?.id) return svc.data.user;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Cliente anon con un solo JWT en headers (RLS como el usuario móvil). */
export function createBearerAnonClient(token: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token.trim()}` } },
  });
}

/**
 * Auth móvil/API: header Bearer + opcional `access_token` en JSON.
 * Devuelve usuario y cliente Supabase listo para queries con RLS.
 */
export async function resolveBearerAuth(
  request: NextRequest,
  body: unknown
): Promise<{ user: User; supabase: SupabaseClient } | null> {
  const tokens = collectAccessTokenCandidates(request, body);
  const user = await resolveUserFromAccessTokenCandidates(tokens);
  if (!user?.id || tokens.length === 0) return null;
  return { user, supabase: createBearerAnonClient(tokens[0]) };
}
