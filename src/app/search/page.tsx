'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import UserRoleBadge from '@/components/UserRoleBadge';
import AppDrawer from '@/components/AppDrawer';
import { rideProximityCheck } from '@/lib/search-proximity';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
});

interface Ride {
  id: string;
  origin_label: string | null;
  destination_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  departure_time: string;
  price_per_seat: number;
  available_seats: number;
  total_seats?: number | null;
  estimated_duration_minutes?: number | null;
  description: string | null;
  driver: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    rating_average: number;
    rating_count: number;
  };
  ride_stops: Array<{
    id: string;
    label: string | null;
    lat: number;
    lng: number;
    stop_order?: number;
  }>;
  /** Si la búsqueda fue por proximidad: distancia a la recogida (km) */
  proximityOriginKm?: number;
  /** Si la búsqueda fue por proximidad: distancia a la bajada (km) */
  proximityDestKm?: number;
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    origin: searchParams.get('origin') || '',
    destination: searchParams.get('destination') || '',
    date: searchParams.get('date') || '',
    seats: parseInt(searchParams.get('seats') || '1'),
    maxPrice: searchParams.get('maxPrice') || '',
    sortBy: 'departure_time',
  });
  const [savingRequest, setSavingRequest] = useState(false);
  const [requestSaved, setRequestSaved] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [acceptedRequestRideId, setAcceptedRequestRideId] = useState<string | null>(null);
  const [requestTime, setRequestTime] = useState('08:00');
  const [visibleCount, setVisibleCount] = useState(20);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const SEARCH_PAGE_SIZE = 20;

  useEffect(() => {
    checkUser();
    searchRides();
  }, [searchParams]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('trip_requests')
        .select('ride_id')
        .eq('user_id', user.id)
        .eq('status', 'accepted')
        .not('ride_id', 'is', null)
        .limit(1);
      const row = Array.isArray(data) ? data[0] : data;
      setAcceptedRequestRideId(row?.ride_id ?? null);
    })();
  }, [user?.id]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') searchRides();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [searchParams]);

  useEffect(() => {
    // Actualizar filtros cuando cambian los searchParams
    setFilters({
      origin: searchParams.get('origin') || '',
      destination: searchParams.get('destination') || '',
      date: searchParams.get('date') || '',
      seats: parseInt(searchParams.get('seats') || '1'),
      maxPrice: searchParams.get('maxPrice') || '',
      sortBy: filters.sortBy,
    });
  }, [searchParams]);

  async function checkUser() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (!user) {
        const next = '/search' + (searchParams.toString() ? '?' + searchParams.toString() : '');
        router.replace('/login?next=' + encodeURIComponent(next));
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        setUserRole(profile.role);
        if (profile.role === 'driver') {
          router.replace('/my-rides');
        }
      }
    } catch (error) {
      router.replace('/login');
    }
  }

  function handleRefresh() {
    searchRides();
  }

  async function searchRides() {
    setLoading(true);
    try {
      const date = searchParams.get('date');
      const origin = searchParams.get('origin');
      const destination = searchParams.get('destination');
      const seats = parseInt(searchParams.get('seats') || '1');

      let query = supabase
        .from('rides')
        .select(`
          *,
          driver:profiles!rides_driver_id_fkey(
            id,
            full_name,
            avatar_url,
            rating_average,
            rating_count
          ),
          ride_stops(*)
        `)
        .eq('status', 'published');

      const hasOriginOrDestination = Boolean(origin?.trim() || destination?.trim());
      if (date) {
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        if (hasOriginOrDestination) {
          // Búsqueda concreta: solo ese día
          const endDate = new Date(date);
          endDate.setHours(23, 59, 59, 999);
          query = query
            .gte('departure_time', startDate.toISOString())
            .lte('departure_time', endDate.toISOString());
        } else {
          // Ver viajes disponibles: desde esa fecha hasta 30 días
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 30);
          endDate.setHours(23, 59, 59, 999);
          query = query
            .gte('departure_time', startDate.toISOString())
            .lte('departure_time', endDate.toISOString());
        }
      } else {
        // Sin fecha: solo viajes futuros (desde ahora hasta 30 días)
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);
        endDate.setHours(23, 59, 59, 999);
        query = query
          .gte('departure_time', now.toISOString())
          .lte('departure_time', endDate.toISOString());
      }

      const { data: ridesData, error } = await query
        .order('departure_time', { ascending: true })
        .limit(150);

      if (error) {
        console.error('Error searching rides:', error);
        setRides([]);
      } else {
        let filtered = (ridesData || []).filter((ride: any) =>
          ride.status === 'published' &&
          ride.departure_time &&
          new Date(ride.departure_time) > new Date()
        );

        const rideIds = filtered.map((r: any) => r.id);
        const bookedByRide: Record<string, number> = {};
        if (rideIds.length > 0) {
          const { data: bookedData, error: rpcError } = await supabase.rpc('get_ride_booked_seats', { ride_ids: rideIds });
          if (!rpcError && bookedData) {
            bookedData.forEach((row: { ride_id: string; booked_seats: number }) => {
              bookedByRide[row.ride_id] = Number(row.booked_seats || 0);
            });
          }
        }

        const totalSeats = (r: any) => Number(r.total_seats ?? r.available_seats ?? 15);
        filtered = filtered.map((ride: any) => {
          const booked = bookedByRide[ride.id];
          const remaining = booked !== undefined
            ? Math.max(0, totalSeats(ride) - booked)
            : Math.max(0, Number(ride.available_seats ?? totalSeats(ride)));
          return { ...ride, available_seats: remaining };
        }).filter((ride: any) => ride.available_seats >= seats);

        if (origin && destination) {
          const [originGeo, destGeo] = await Promise.all([
            fetch(`/api/geocode/search?q=${encodeURIComponent(origin.trim())}&limit=1&countrycodes=py`).then((r) => r.ok ? r.json() : []),
            fetch(`/api/geocode/search?q=${encodeURIComponent(destination.trim())}&limit=1&countrycodes=py`).then((r) => r.ok ? r.json() : []),
          ]);
          const originPoint = Array.isArray(originGeo) && originGeo[0] ? { lat: parseFloat(originGeo[0].lat), lng: parseFloat(originGeo[0].lon) } : null;
          const destPoint = Array.isArray(destGeo) && destGeo[0] ? { lat: parseFloat(destGeo[0].lat), lng: parseFloat(destGeo[0].lon) } : null;
          if (originPoint && destPoint) {
            const withProximity: any[] = [];
            for (const ride of filtered) {
              const result = rideProximityCheck(ride, originPoint, destPoint);
              if (result.match) {
                withProximity.push({
                  ...ride,
                  proximityOriginKm: Math.round((result.distanceOriginMeters / 1000) * 10) / 10,
                  proximityDestKm: Math.round((result.distanceDestMeters / 1000) * 10) / 10,
                });
              }
            }
            filtered = withProximity;
          } else {
            if (origin) {
              filtered = filtered.filter((ride: any) =>
                ride.origin_label?.toLowerCase().includes(origin.toLowerCase())
              );
            }
            if (destination) {
              filtered = filtered.filter((ride: any) =>
                ride.destination_label?.toLowerCase().includes(destination.toLowerCase())
              );
            }
          }
        } else {
          if (origin) {
            filtered = filtered.filter((ride: any) =>
              ride.origin_label?.toLowerCase().includes(origin.toLowerCase())
            );
          }
          if (destination) {
            filtered = filtered.filter((ride: any) =>
              ride.destination_label?.toLowerCase().includes(destination.toLowerCase())
            );
          }
        }

        if (filters.maxPrice && filters.maxPrice !== '') {
          const maxPrice = parseFloat(filters.maxPrice);
          filtered = filtered.filter((ride: any) =>
            ride.price_per_seat <= maxPrice
          );
        }

        if (filters.sortBy === 'price_per_seat') {
          filtered.sort((a: any, b: any) => a.price_per_seat - b.price_per_seat);
        } else if (filters.sortBy === 'available_seats') {
          filtered.sort((a: any, b: any) => b.available_seats - a.available_seats);
        }

        setRides(filtered);
        setVisibleCount(SEARCH_PAGE_SIZE);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(key: string, value: any) {
    setFilters({ ...filters, [key]: value });
  }

  function applyFilters() {
    setRequestSaved(false);
    setRequestError(null);
    const params = new URLSearchParams();
    if (filters.origin) params.set('origin', filters.origin);
    if (filters.destination) params.set('destination', filters.destination);
    if (filters.date) params.set('date', filters.date);
    params.set('seats', filters.seats.toString());
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
    router.push(`/search?${params.toString()}`);
  }

  async function handleSaveTripRequest() {
    if (!user?.id || !filters.origin?.trim() || !filters.destination?.trim() || !filters.date || !requestTime?.trim()) return;
    setSavingRequest(true);
    setRequestError(null);
    try {
      const [originGeo, destGeo] = await Promise.all([
        fetch(`/api/geocode/search?q=${encodeURIComponent(filters.origin.trim())}&limit=1&countrycodes=py`).then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/geocode/search?q=${encodeURIComponent(filters.destination.trim())}&limit=1&countrycodes=py`).then((r) => (r.ok ? r.json() : [])),
      ]);
      const o = Array.isArray(originGeo) && originGeo[0] ? originGeo[0] : null;
      const d = Array.isArray(destGeo) && destGeo[0] ? destGeo[0] : null;
      if (!o || !d) {
        setRequestError('No se pudo ubicar el origen o el destino. Probá con direcciones más específicas.');
        setSavingRequest(false);
        return;
      }
      const requestedDate = new Date(filters.date);
      if (isNaN(requestedDate.getTime())) {
        setRequestError('Fecha inválida.');
        setSavingRequest(false);
        return;
      }
      const timeStr = requestTime.trim().match(/^\d{1,2}:\d{2}$/) ? requestTime.trim() : '08:00';
      const { error } = await supabase.from('trip_requests').insert({
        user_id: user.id,
        origin_lat: parseFloat(o.lat),
        origin_lng: parseFloat(o.lon),
        origin_label: filters.origin.trim().slice(0, 500),
        destination_lat: parseFloat(d.lat),
        destination_lng: parseFloat(d.lon),
        destination_label: filters.destination.trim().slice(0, 500),
        requested_date: filters.date,
        requested_time: timeStr,
        seats: Math.max(1, Math.min(50, filters.seats)),
        status: 'pending',
      });
      if (error) throw error;
      setRequestSaved(true);
    } catch (e: any) {
      setRequestError(e?.message || 'No se pudo guardar la solicitud.');
    } finally {
      setSavingRequest(false);
    }
  }

  function formatPrice(price: number) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(price);
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <ul className="space-y-0.5">
          {user && (
            <li className="flex items-center gap-2 py-3 pb-2">
              <UserRoleBadge />
            </li>
          )}
          <li>
            <Link href="/" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Buscar viajes
            </Link>
          </li>
          {userRole === 'driver' && (
            <li>
              <Link href="/publish" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
                Publicar viaje
              </Link>
            </li>
          )}
          {user && userRole !== 'driver' && (
            <>
              <li>
                <Link href="/my-bookings" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
                  Mis reservas
                </Link>
              </li>
              <li>
                <Link href="/my-trip-requests" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
                  Mis solicitudes
                </Link>
              </li>
            </>
          )}
          {user && (
            <li>
              <Link href="/messages" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
                Mensajes
              </Link>
            </li>
          )}
          {user && (
            <>
              <li>
                <Link href="/offer" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
                  Viajes a oferta
                </Link>
              </li>
              <li className="pt-2 mt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((v) => !v)}
                  className="w-full text-left px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center justify-between"
                >
                  <span className="flex items-center gap-2">
                    <span>⚙️</span>
                    <span>Configuraciones</span>
                  </span>
                  <span className="text-xs text-gray-500">{settingsOpen ? '▲' : '▼'}</span>
                </button>
              </li>
              {settingsOpen && (
                <>
                  <li className="pl-8">
                    <Link
                      href="/settings/navigation"
                      onClick={() => { setSettingsOpen(false); setDrawerOpen(false); }}
                      className="block px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[40px] flex items-center"
                    >
                      Preferencia de navegación
                    </Link>
                  </li>
                  <li className="pl-8">
                    <Link
                      href="/settings/permissions"
                      onClick={() => { setSettingsOpen(false); setDrawerOpen(false); }}
                      className="block px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[40px] flex items-center"
                    >
                      Permisos de la app
                    </Link>
                  </li>
                </>
              )}
            </>
          )}
          {user ? (
            <li className="pt-3 mt-2 border-t border-gray-200">
              <button
                type="button"
                onClick={() => { setDrawerOpen(false); supabase.auth.signOut().then(() => { window.location.href = '/'; }); }}
                className="w-full text-left px-4 py-3 rounded-xl text-gray-600 hover:bg-gray-100 font-medium min-h-[44px] flex items-center"
              >
                Cerrar sesión
              </button>
            </li>
          ) : (
            <li className="pt-3 mt-2 border-t border-gray-200">
              <Link href="/login" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl btn-primary text-center min-h-[44px] flex items-center justify-center">
                Iniciar sesión
              </Link>
            </li>
          )}
        </ul>
      </AppDrawer>

      <header className="bg-white shadow-sm border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40 p-4 flex justify-between items-center">
        <Link href="/" className="text-lg font-bold text-green-600 shrink-0">Xhare</Link>
        <div className="flex items-center gap-2">
          {user && <UserRoleBadge />}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl text-gray-600 hover:bg-gray-100 flex items-center justify-center"
            aria-label="Abrir menú"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      <div className="app-mobile-px py-4 lg:py-6 max-w-6xl mx-auto">
        {acceptedRequestRideId && (
          <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded-xl">
            <p className="font-medium text-green-800">
              Un conductor publicó un viaje para una solicitud que guardaste.
            </p>
            <Link
              href={`/rides/${acceptedRequestRideId}`}
              className="inline-block mt-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
            >
              Ver viaje
            </Link>
          </div>
        )}
        <div className="grid lg:grid-cols-4 gap-4 lg:gap-6">
          {/* Filters Sidebar / Card Buscar viajes */}
          <div className="lg:col-span-1">
            <div className="bg-white app-mobile-card rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 lg:sticky lg:top-4">
              <h2 className="text-base md:text-lg font-semibold text-gray-900 mb-4">Buscar viajes</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Origen</label>
                  <input
                    type="text"
                    value={filters.origin}
                    onChange={(e) => handleFilterChange('origin', e.target.value)}
                    placeholder="Ciudad o dirección"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Destino</label>
                  <input
                    type="text"
                    value={filters.destination}
                    onChange={(e) => handleFilterChange('destination', e.target.value)}
                    placeholder="Ciudad o dirección"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Fecha</label>
                  <input
                    type="date"
                    value={filters.date}
                    onChange={(e) => handleFilterChange('date', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Pasajeros</label>
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={filters.seats}
                    onChange={(e) => handleFilterChange('seats', parseInt(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Precio máximo</label>
                  <input
                    type="number"
                    value={filters.maxPrice}
                    onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
                    placeholder="Sin límite"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                <button
                  type="button"
                  onClick={applyFilters}
                  className="w-full px-4 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition"
                >
                  Aplicar filtros
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-3">
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Buscando viajes...</p>
              </div>
            ) : rides.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-12 text-center">
                <p className="text-xl text-gray-600 mb-4">No se encontraron viajes</p>
                <p className="text-gray-500 mb-2">
                  Con origen y destino buscamos viajes que pasen a hasta 2 km de tu recogida y de tu bajada. Sin origen ni destino mostramos viajes en los próximos 30 días.
                </p>
                <p className="text-gray-500 mb-2">
                  Probá otra fecha o quitá la fecha para ver todos los próximos.
                </p>
                {user && filters.origin?.trim() && filters.destination?.trim() && filters.date && (
                  <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl text-left max-w-md mx-auto">
                    <p className="text-sm font-medium text-green-800 mb-2">
                      ¿Querés que los conductores vean tu trayecto y puedan publicar un viaje?
                    </p>
                    <p className="text-xs text-green-700 mb-3">
                      Guardá tu solicitud y los choferes la verán en &quot;Solicitudes de trayecto&quot;. Si alguno publica un viaje para esta ruta, podrás reservar.
                    </p>
                    {requestSaved ? (
                      <p className="text-sm font-semibold text-green-700">
                        Solicitud guardada. Los conductores ya pueden verla.{' '}
                        <Link href="/my-trip-requests" className="underline">Ver mis solicitudes</Link>
                      </p>
                    ) : (
                      <>
                        <div className="mb-3">
                          <label className="block text-sm font-medium text-green-800 mb-1">Hora en que querés que te recojan *</label>
                          <input
                            type="time"
                            value={requestTime}
                            onChange={(e) => setRequestTime(e.target.value)}
                            className="w-full px-3 py-2 border border-green-300 rounded-lg"
                            required
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleSaveTripRequest}
                          disabled={savingRequest}
                          className="w-full px-4 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-60"
                        >
                          {savingRequest ? 'Guardando...' : 'Guardar mi solicitud'}
                        </button>
                        {requestError && <p className="text-sm text-red-600 mt-2">{requestError}</p>}
                      </>
                    )}
                  </div>
                )}
                <p className="text-gray-500 mt-6 mb-6">
                  {userRole === 'driver'
                    ? 'O publicá un viaje para que aparezca aquí.'
                    : !user
                      ? 'Si sos chofer, iniciá sesión para publicar un viaje.'
                      : null}
                </p>
                {userRole === 'driver' ? (
                  <Link
                    href="/publish"
                    className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    Publicar viaje
                  </Link>
                ) : !user ? (
                  <Link
                    href="/login"
                    className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    Iniciar sesión
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900">
                    {rides.length} viaje{rides.length !== 1 ? 's' : ''} encontrado{rides.length !== 1 ? 's' : ''}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={loading}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Actualizar
                    </button>
                    <select
                      value={filters.sortBy}
                      onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                      className="px-4 py-2 border rounded-lg"
                    >
                      <option value="departure_time">Más temprano</option>
                      <option value="price_per_seat">Más barato</option>
                      <option value="available_seats">Más asientos</option>
                    </select>
                  </div>
                </div>

                {rides.slice(0, visibleCount).map((ride) => (
                  <Link
                    key={ride.id}
                    href={`/rides/${ride.id}`}
                    className="block bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition p-4 md:p-6 mb-4 last:mb-0"
                  >
                    <div className="flex gap-6">
                      {/* Driver Info */}
                      <div className="flex-shrink-0">
                        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                          {ride.driver?.avatar_url ? (
                            <img
                              src={ride.driver.avatar_url}
                              alt={ride.driver.full_name || 'Conductor'}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-2xl">👤</span>
                          )}
                        </div>
                        <div className="text-center mt-2">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-yellow-400">★</span>
                            <span className="text-sm font-medium">
                              {ride.driver?.rating_average?.toFixed(1) || 'Nuevo'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">
                            {ride.driver?.rating_count || 0} viaje{ride.driver?.rating_count !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>

                      {/* Ride Info */}
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="text-lg font-semibold">
                              {ride.origin_label || 'Origen'} → {ride.destination_label || 'Destino'}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {formatDate(ride.departure_time)}
                            </p>
                          </div>
                          <div className="text-right">
                            {(ride.price_per_seat != null && Number(ride.price_per_seat) > 0) ? (
                              <>
                                <p className="text-2xl font-bold text-green-600">
                                  {formatPrice(ride.price_per_seat)}
                                </p>
                                <p className="text-sm text-gray-500">por asiento</p>
                              </>
                            ) : (
                              <p className="text-sm text-gray-600">Precio según tu tramo</p>
                            )}
                          </div>
                        </div>

                        {(ride.proximityOriginKm != null || ride.proximityDestKm != null) && (
                          <p className="text-sm text-green-700 mb-2">
                            Pasa a {ride.proximityOriginKm != null ? `${ride.proximityOriginKm} km` : '—'} de tu recogida · {ride.proximityDestKm != null ? `${ride.proximityDestKm} km` : '—'} de tu bajada
                          </p>
                        )}
                        {ride.description && (
                          <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                            {ride.description}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <span>💺</span>
                            {ride.available_seats} asiento{ride.available_seats !== 1 ? 's' : ''} disponible{ride.available_seats !== 1 ? 's' : ''}
                          </span>
                          {ride.estimated_duration_minutes != null && ride.estimated_duration_minutes >= 1 && (
                            <span className="flex items-center gap-1">
                              <span>⏱</span>
                              {ride.estimated_duration_minutes < 60
                                ? `${Math.round(ride.estimated_duration_minutes)} min`
                                : `${Math.floor(ride.estimated_duration_minutes / 60)} h ${Math.round(ride.estimated_duration_minutes % 60)} min`}
                            </span>
                          )}
                          {ride.ride_stops && ride.ride_stops.length > 0 && (
                            <span className="flex items-center gap-1">
                              <span>📍</span>
                              {ride.ride_stops.length} parada{ride.ride_stops.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {rides.length > visibleCount && (
                  <div className="flex justify-center mt-4">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((c) => c + SEARCH_PAGE_SIZE)}
                      className="px-6 py-2.5 border border-green-600 text-green-600 font-medium rounded-xl hover:bg-green-50 transition"
                    >
                      Cargar más ({rides.length - visibleCount} restantes)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
