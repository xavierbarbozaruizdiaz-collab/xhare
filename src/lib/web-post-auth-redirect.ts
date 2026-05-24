/** Campos de perfil usados para decidir a dónde enviar al usuario tras login web. */
export type WebPostAuthProfile = {
  role: string;
  terms_accepted_at?: string | null;
  privacy_accepted_at?: string | null;
  driver_approved_at?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | null;
  vehicle_seat_count?: number | null;
};

export const WEB_POST_AUTH_PROFILE_SELECT =
  'role, terms_accepted_at, privacy_accepted_at, driver_approved_at, vehicle_model, vehicle_year, vehicle_seat_count';

export function driverNeedsVehicleSetup(
  profile: Pick<WebPostAuthProfile, 'role' | 'vehicle_model' | 'vehicle_year' | 'vehicle_seat_count'>
): boolean {
  if (profile.role !== 'driver' && profile.role !== 'driver_pending') return false;
  return (
    profile.vehicle_seat_count == null ||
    !String(profile.vehicle_model ?? '').trim() ||
    profile.vehicle_year == null
  );
}

/**
 * Ruta post-login web. Conductores sin vehículo cargado → `/driver/setup`.
 */
export function resolveWebPostAuthPath(profile: WebPostAuthProfile, nextUrl?: string | null): string {
  if (!profile.terms_accepted_at || !profile.privacy_accepted_at) {
    return '/legal/accept';
  }
  if (profile.role === 'admin') return '/admin';
  if (profile.role === 'passenger') return '/descargar';

  if (profile.role === 'driver_pending' || profile.role === 'driver') {
    const next = (nextUrl ?? '').trim();
    if (next === '/driver/setup' || next.startsWith('/driver/setup?')) return next;

    if (driverNeedsVehicleSetup(profile)) return '/driver/setup';
    if (profile.role === 'driver_pending') return '/driver/pending';
    return '/descargar';
  }

  const fallback = (nextUrl ?? '').trim();
  if (fallback.startsWith('/')) return fallback;
  return '/';
}
