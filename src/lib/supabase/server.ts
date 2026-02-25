import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function createServerClient() {
  const cookieStore = cookies();
  const requestHeaders = headers();
  const authHeader = requestHeaders.get('authorization');

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

export function createServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

