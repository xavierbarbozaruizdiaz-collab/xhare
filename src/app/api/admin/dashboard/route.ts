import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';

/**
 * Dashboard admin con métricas separadas.
 * Auth: JWT en header Authorization o sesión en cookies; rol admin con service role.
 */
function getJwtFromRequest(request: NextRequest): string | null {
  const auth =
    request.headers.get('authorization') ??
    request.headers.get('Authorization') ??
    '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const custom = request.headers.get('x-admin-token');
  return custom?.trim() ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const jwt = getJwtFromRequest(request);
    const supabaseAuth = createServerClient(request);

    let user: { id: string } | null = null;
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

    // ——— Sección UberPool (rides, bookings, boarding, ratings) ———
    const [
      ridesPublished,
      ridesEnRoute,
      ridesCompleted,
      ridesAll,
      bookingsRes,
      driverRatingsRes,
      passengerRatingsRes,
    ] = await Promise.all([
      service.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      service.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'en_route'),
      service.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      service.from('rides').select('id, status'),
      service.from('bookings').select('id, status, seats_count'),
      service.from('driver_ratings').select('stars'),
      service.from('passenger_ratings').select('stars'),
    ]);

    const bookings = bookingsRes.data ?? [];
    const totalBookings = bookings.length;
    const cancelledBookings = bookings.filter((b: { status: string }) => b.status === 'cancelled').length;
    const seatsOccupied = bookings
      .filter((b: { status: string }) => b.status !== 'cancelled')
      .reduce((sum: number, b: { seats_count?: number }) => sum + (b.seats_count ?? 0), 0);
    const cancellationRate =
      totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 100) : 0;

    const driverRatings = driverRatingsRes.data ?? [];
    const passengerRatings = passengerRatingsRes.data ?? [];
    const avgDriverRating =
      driverRatings.length > 0
        ? Math.round((driverRatings.reduce((s: number, r: { stars: number }) => s + r.stars, 0) / driverRatings.length) * 10) / 10
        : null;
    const avgPassengerRating =
      passengerRatings.length > 0
        ? Math.round((passengerRatings.reduce((s: number, r: { stars: number }) => s + r.stars, 0) / passengerRatings.length) * 10) / 10
        : null;

    const activeRides = (ridesAll.data ?? []).filter((r: { status: string }) =>
      ['published', 'booked', 'en_route'].includes(r.status)
    );
    const activeRideIds = activeRides.map((r: { id: string }) => r.id);

    let activeRidesWithDriver: any[] = [];
    if (activeRideIds.length > 0) {
      const { data: withDriver } = await service
        .from('rides')
        .select('*, driver:profiles!rides_driver_id_fkey(id, full_name)')
        .in('id', activeRideIds)
        .order('departure_time', { ascending: true });
      activeRidesWithDriver = withDriver ?? [];
    }

    const uberpool = {
      totalViajesPublicados: ridesPublished.count ?? 0,
      viajesEnCurso: ridesEnRoute.count ?? 0,
      viajesCompletados: ridesCompleted.count ?? 0,
      totalReservas: totalBookings,
      asientosOcupados: seatsOccupied,
      tasaCancelacion: cancellationRate,
      ratingPromedioConductor: avgDriverRating,
      ratingPromedioPasajero: avgPassengerRating,
      activeRides: activeRidesWithDriver,
    };

    // ——— Sección InDriver (passenger_ride_requests, driver_ride_availability, offers) ———
    const [
      passengerRequestsRes,
      driverAvailabilityRes,
      driverOffersRes,
      passengerOffersRes,
    ] = await Promise.all([
      service.from('passenger_ride_requests').select('id, status'),
      service.from('driver_ride_availability').select('id, status'),
      service.from('driver_offers').select('id, status, ride_id, proposed_price_per_seat'),
      service.from('passenger_offers').select('id, status, ride_id, offered_price_per_seat'),
    ]);

    const driverOffers = driverOffersRes.data ?? [];
    const passengerOffers = passengerOffersRes.data ?? [];
    const offersAccepted =
      driverOffers.filter((o: { status: string }) => o.status === 'accepted').length +
      passengerOffers.filter((o: { status: string }) => o.status === 'accepted').length;
    const ridesFromOffers =
      new Set([
        ...driverOffers.filter((o: { ride_id: string | null }) => o.ride_id).map((o: { ride_id: string }) => o.ride_id),
        ...passengerOffers.filter((o: { ride_id: string | null }) => o.ride_id).map((o: { ride_id: string }) => o.ride_id),
      ]).size;

    const indriver = {
      solicitudesCreadas: (passengerRequestsRes.data ?? []).length,
      disponibilidadesCreadas: (driverAvailabilityRes.data ?? []).length,
      ofertasEnviadas: driverOffers.length + passengerOffers.length,
      ofertasAceptadas: offersAccepted,
      viajesCreadosDesdeOferta: ridesFromOffers,
      // Precio promedio: simplificado (ofertas aceptadas podrían cruzarse con bookings después)
      precioPromedioOfertadoDriver:
        driverOffers.length > 0
          ? Math.round(
              driverOffers.reduce((s: number, o: { proposed_price_per_seat?: number }) => s + (o.proposed_price_per_seat ?? 0), 0) /
                driverOffers.length
            )
          : null,
      precioPromedioOfertadoPassenger:
        passengerOffers.length > 0
          ? Math.round(
              passengerOffers.reduce((s: number, o: { offered_price_per_seat?: number }) => s + (o.offered_price_per_seat ?? 0), 0) /
                passengerOffers.length
            )
          : null,
    };

    // Perfiles (común)
    const { data: profilesByRole } = await service.from('profiles').select('role');
    const pendingDrivers = profilesByRole?.filter((p) => p.role === 'driver_pending').length ?? 0;
    const totalDrivers = profilesByRole?.filter((p) => p.role === 'driver').length ?? 0;
    const totalPassengersProfile = profilesByRole?.filter((p) => p.role === 'passenger').length ?? 0;

    return NextResponse.json({
      uberpool,
      indriver,
      profiles: {
        pendingDrivers,
        totalDrivers,
        totalPassengersProfile,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
