import type { Session } from '@supabase/supabase-js';
import { supabase } from '../backend/supabase';
import { raceWithTimeout } from '../backend/withTimeout';

const GET_SESSION_TIMEOUT_MS = 12_000;
/** Sin tope, PostgREST puede no resolver y `refreshSession` tras login queda colgado para siempre. */
const PROFILE_FETCH_TIMEOUT_MS = 12_000;

// En este proyecto no hay un `src/types.ts` estable.
// Definimos el shape mínimo que usa la app (role/id) + campos extra.
export type SessionProfile = {
  id: string;
  role: string | null;
  access_token: string;
  email: string | null;
  full_name?: string | null;
  [key: string]: unknown;
};

function pickAccessToken(session: Session | null): string {
  // supabase-js Session expone `access_token`; si no existe, dejamos vacío.
  return (session as any)?.access_token ? String((session as any).access_token) : '';
}

export async function getSessionProfileFromSession(session: Session | null): Promise<SessionProfile | null> {
  try {
    const userId = session?.user?.id;
    if (!userId) return null;

    const access_token = pickAccessToken(session);
    if (!access_token) return null;

    const profileQuery = supabase
      .from('profiles')
      .select(
        `
          id,
          role,
          full_name,
          phone,
          avatar_url,
          bio,
          rating_average,
          rating_count,
          verified,
          vehicle_photo_url,
          vehicle_model,
          vehicle_year,
          available,
          created_at
        `
      )
      .eq('id', userId)
      .maybeSingle();

    const { data: profile, error } = await raceWithTimeout(
      profileQuery,
      PROFILE_FETCH_TIMEOUT_MS,
      () =>
        ({
          data: null,
          error: { message: 'PROFILE_FETCH_TIMEOUT', code: 'TIMEOUT', details: '', hint: '' },
        }) as Awaited<typeof profileQuery>
    );

    if (error && (error as { message?: string }).message === 'PROFILE_FETCH_TIMEOUT') {
      return null;
    }
    if (error || !profile) return null;

    return {
      ...(profile as Record<string, unknown>),
      access_token,
      email: session.user?.email ?? null,
    } as SessionProfile;
  } catch {
    return null;
  }
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const {
    data: { session },
  } = await raceWithTimeout(supabase.auth.getSession(), GET_SESSION_TIMEOUT_MS, () => ({
    data: { session: null },
    error: null,
  }));
  return getSessionProfileFromSession(session);
}

