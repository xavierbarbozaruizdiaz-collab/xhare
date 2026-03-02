import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

type AuthResult =
  | { user: User; supabase: ReturnType<typeof createServerClient> }
  | NextResponse;

type DriverRideResult =
  | { user: User; supabase: ReturnType<typeof createServerClient>; ride: { id: string; driver_id: string; [k: string]: unknown } }
  | NextResponse;

/**
 * Obtiene el usuario autenticado. Usar en todas las rutas API que requieran login.
 * @param req Request opcional (Route Handlers): se usa para leer Authorization del request entrante.
 * @returns { user, supabase } o NextResponse 401
 */
export async function getAuth(req?: Request): Promise<AuthResult> {
  const supabase = createServerClient(req);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[getAuth] AUTH_DEBUG', { authError: authError?.message ?? null, hasUser: !!user });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { user, supabase };
}

/**
 * Exige que el usuario sea conductor. Útil para rutas solo de conductores.
 * @param req Request opcional (Route Handlers): se usa para leer Authorization.
 * @returns { user, supabase } o NextResponse 401/403
 */
export async function requireDriver(req?: Request): Promise<AuthResult> {
  const auth = await getAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: profile } = await auth.supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (!profile || profile.role !== 'driver') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return auth;
}

/**
 * Exige que el usuario sea admin.
 * @returns { user, supabase } o NextResponse 401/403
 */
export async function requireAdmin(): Promise<AuthResult> {
  const auth = await getAuth();
  if (auth instanceof NextResponse) return auth;

  const { data: profile } = await auth.supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return auth;
}

/**
 * Exige que el usuario sea conductor y dueño del viaje.
 * @param rideId UUID del viaje
 * @param req Request opcional (Route Handlers): se usa para leer Authorization.
 * @returns { user, supabase, ride } o NextResponse 401/403/404
 */
export async function requireDriverOwnsRide(rideId: string, req?: Request): Promise<DriverRideResult> {
  const auth = await requireDriver(req);
  if (auth instanceof NextResponse) return auth;

  const { data: ride } = await auth.supabase
    .from('rides')
    .select('id, driver_id, status')
    .eq('id', rideId)
    .single();

  if (!ride || ride.driver_id !== auth.user.id) {
    return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
  }
  return { ...auth, ride };
}
