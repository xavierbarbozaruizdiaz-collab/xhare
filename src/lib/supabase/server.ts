import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder-service-key';

/** Optional request: when provided (e.g. in Route Handlers), auth is read from that request's headers. */
export function createServerClient(incomingRequest?: Request) {
  const cookieStore = cookies();
  const sourceHeaders = incomingRequest ? incomingRequest.headers : headers();
  const authHeader = sourceHeaders.get('authorization') ?? sourceHeaders.get('Authorization');

  if (process.env.NODE_ENV === 'development') {
    console.log('[createServerClient] AUTH_DEBUG', { authSource: authHeader ? 'Bearer' : 'cookie' });
  }

  // Prefer explicit Authorization header (Bearer token from client) if present.
  if (authHeader) {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
      },
      global: {
        headers: {
          authorization: authHeader,
        },
      },
    });
  }

  // Fallback to cookie-based auth (for future SSR flows that use Supabase cookies)
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
    global: {
      headers: {
        cookie: cookieStore.toString(),
      },
    },
  });
}

/**
 * With persistSession: false, auth.getUser() does not infer the user from global Authorization;
 * pass the Bearer JWT explicitly when present (mobile app and API clients).
 */
export async function authGetUser(
  supabase: SupabaseClient,
  incomingRequest?: Request
) {
  const sourceHeaders = incomingRequest ? incomingRequest.headers : headers();
  const h = sourceHeaders.get('authorization') ?? sourceHeaders.get('Authorization');
  const m = h?.trim() ? /^Bearer\s+(\S+)/i.exec(h.trim()) : null;
  const jwt = m?.[1] ?? null;
  if (jwt) return supabase.auth.getUser(jwt);
  return supabase.auth.getUser();
}

export function createServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

