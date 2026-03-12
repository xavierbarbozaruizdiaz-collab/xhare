'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase/client';
import AppDrawer from '@/components/AppDrawer';
import UserRoleBadge from '@/components/UserRoleBadge';

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false });

type MapPoint = { lat: number; lng: number; label?: string } | null;

type AuthState = 'loading' | 'guest' | 'passenger' | 'driver';

export default function Home() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>('loading');

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState('');
  const [seats, setSeats] = useState(1);
  const [locatingFor, setLocatingFor] = useState<'origin' | 'destination' | null>(null);
  const [inlineMapReady, setInlineMapReady] = useState(false);
  const [originMapPoint, setOriginMapPoint] = useState<MapPoint>(null);
  const [destinationMapPoint, setDestinationMapPoint] = useState<MapPoint>(null);
  const [mapActiveField, setMapActiveField] = useState<'pickup' | 'dropoff' | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Verificar sesión y rol: guest → landing; driver → my-rides; passenger → búsqueda
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setAuthState('guest');
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        if (cancelled) return;
        if (profile?.role === 'driver') {
          setAuthState('driver');
          router.replace('/my-rides');
          return;
        }
        setAuthState('passenger');
      } catch {
        if (!cancelled) setAuthState('guest');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (authState !== 'passenger') return;
    const t = setTimeout(() => setInlineMapReady(true), 200);
    return () => clearTimeout(t);
  }, [authState]);

  async function handleUseMyLocation(field: 'origin' | 'destination') {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta la geolocalización.');
      return;
    }
    setLocatingFor(field);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        try {
          const res = await fetch(
            `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
          );
          if (res.ok) {
            const data = await res.json();
            const label = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            if (field === 'origin') {
              setOrigin(label);
              setOriginMapPoint({ lat, lng, label });
            } else {
              setDestination(label);
              setDestinationMapPoint({ lat, lng, label });
            }
          } else {
            const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            if (field === 'origin') {
              setOrigin(coords);
              setOriginMapPoint({ lat, lng, label: coords });
            } else {
              setDestination(coords);
              setDestinationMapPoint({ lat, lng, label: coords });
            }
          }
        } catch {
          const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          if (field === 'origin') {
            setOrigin(coords);
            setOriginMapPoint({ lat, lng, label: coords });
          } else {
            setDestination(coords);
            setDestinationMapPoint({ lat, lng, label: coords });
          }
        }
        setLocatingFor(null);
      },
      () => {
        alert('No se pudo obtener tu ubicación. Revisa los permisos del navegador.');
        setLocatingFor(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function handleMapSelectOrigin(point: { lat: number; lng: number; label?: string }) {
    setOrigin(point.label || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
    setOriginMapPoint(point);
  }

  function handleMapSelectDestination(point: { lat: number; lng: number; label?: string }) {
    setDestination(point.label || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
    setDestinationMapPoint(point);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!origin || !destination || !date) {
      alert('Por favor completa todos los campos');
      return;
    }
    router.push(`/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${date}&seats=${seats}`);
  }

  // Loading inicial
  if (authState === 'loading' || authState === 'driver') {
    return (
      <div className="min-h-screen bg-gray-50 app-mobile-shell flex items-center justify-center">
        <div className="text-center text-gray-700">
          <div className="inline-block w-10 h-10 border-2 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p>{authState === 'driver' ? 'Redirigiendo a tus viajes...' : 'Cargando...'}</p>
        </div>
      </div>
    );
  }

  // Landing: no logueado
  if (authState === 'guest') {
    return (
      <div className="min-h-screen bg-gray-50 app-mobile-shell">
        <header className="bg-white border-b border-gray-200 shadow-sm app-mobile-px app-mobile-header sticky top-0 z-40">
          <div className="flex justify-between items-center py-2 min-h-[48px]">
            <Link href="/" className="text-lg font-bold text-green-600">Xhare</Link>
            <Link href="/login" className="btn-primary text-sm py-2 min-h-[44px]">
              Iniciar sesión
            </Link>
          </div>
        </header>
        <div className="app-mobile-px py-10 max-w-2xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 text-center">
            Viaja compartiendo
          </h1>
          <p className="text-gray-600 mb-6 text-center">
            Conecta con conductores y pasajeros. Viajá más barato y de forma sostenible.
          </p>
          <p className="text-gray-500 mb-8 text-center text-sm">
            Iniciá sesión para <strong>buscar viajes</strong> como pasajero o para <strong>publicar tu viaje</strong> como conductor.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <Link href="/login" className="btn-primary">
              Iniciar sesión
            </Link>
            <Link href="/login?signup=1" className="btn-secondary">
              Crear cuenta
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="app-mobile-card p-5 bg-white">
              <div className="text-2xl mb-2">💰</div>
              <h3 className="font-semibold text-gray-900 mb-1">Precios justos</h3>
              <p className="text-sm text-gray-500">Compartí costos y ahorrá</p>
            </div>
            <div className="app-mobile-card p-5 bg-white">
              <div className="text-2xl mb-2">🌱</div>
              <h3 className="font-semibold text-gray-900 mb-1">Viaja sostenible</h3>
              <p className="text-sm text-gray-500">Menos huella de carbono</p>
            </div>
            <div className="app-mobile-card p-5 bg-white">
              <div className="text-2xl mb-2">🤝</div>
              <h3 className="font-semibold text-gray-900 mb-1">Conecta personas</h3>
              <p className="text-sm text-gray-500">Conocé gente en el camino</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Pasajero logueado: mapa + búsqueda (temática unificada)
  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <ul className="space-y-0.5">
          <li className="flex items-center gap-2 py-3 pb-2">
            <UserRoleBadge />
          </li>
          <li>
            <Link href="/" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Buscar viajes
            </Link>
          </li>
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
          <li>
            <Link href="/messages" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Mensajes
            </Link>
          </li>
          <li>
            <Link href="/offer" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Viajes a oferta
            </Link>
          </li>
          <li className="pt-3 mt-2 border-t border-gray-200">
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
            <li className="pl-8">
              <Link
                href="/settings/navigation"
                onClick={() => { setSettingsOpen(false); setDrawerOpen(false); }}
                className="block px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[40px] flex items-center"
              >
                Preferencia de navegación
              </Link>
            </li>
          )}
          <li className="pt-1">
            <button
              type="button"
              onClick={() => { setDrawerOpen(false); supabase.auth.signOut().then(() => { window.location.href = '/'; }); }}
              className="w-full text-left px-4 py-3 rounded-xl text-gray-600 hover:bg-gray-100 font-medium min-h-[44px] flex items-center"
            >
              Cerrar sesión
            </button>
          </li>
        </ul>
      </AppDrawer>

      <header className="bg-white shadow-sm border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40 p-4 flex justify-between items-center">
        <Link href="/" className="text-lg font-bold text-green-600 shrink-0">Xhare</Link>
        <div className="flex items-center gap-2">
          <UserRoleBadge />
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

      <div className="app-mobile-px py-6 max-w-4xl mx-auto app-mobile-section">
        <div className="mb-6">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-1">Buscar viajes</h1>
          <p className="text-gray-600 text-sm md:text-base">
            Elegí origen y destino, fecha y pasajeros. Los conductores publican sus rutas y vos reservás.
          </p>
          <Link
            href={`/search?date=${new Date().toISOString().split('T')[0]}&seats=1`}
            className="inline-block mt-3 btn-primary"
          >
            Ver viajes disponibles
          </Link>
        </div>

        <div className="app-mobile-card overflow-hidden bg-white mb-6">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-800">Elige origen y destino en el mapa</h2>
            <p className="text-sm text-gray-500 mt-0.5">Recogida / Destino en el mapa o «Mi ubicación».</p>
          </div>
          <div className="flex gap-2 p-2 border-b border-gray-100">
            <button
              type="button"
              onClick={() => setMapActiveField('pickup')}
              className={`flex-1 min-h-[44px] rounded-lg font-medium transition ${mapActiveField === 'pickup' ? 'tab-segment-active' : 'tab-segment'}`}
            >
              Recogida
            </button>
            <button
              type="button"
              onClick={() => setMapActiveField('dropoff')}
              className={`flex-1 min-h-[44px] rounded-lg font-medium transition ${mapActiveField === 'dropoff' ? 'tab-segment-active' : 'tab-segment'}`}
            >
              Destino
            </button>
          </div>
          <div className="h-[280px] w-full relative bg-gray-100">
            {inlineMapReady ? (
              <MapComponent
                pickup={originMapPoint}
                dropoff={destinationMapPoint}
                onPickupSelect={handleMapSelectOrigin}
                onDropoffSelect={handleMapSelectDestination}
                activeMode={mapActiveField}
                onModeChange={setMapActiveField}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                <span className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2" />
                Cargando mapa...
              </div>
            )}
          </div>
          <div className="p-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => handleUseMyLocation(mapActiveField === 'dropoff' ? 'destination' : 'origin')}
              disabled={locatingFor !== null}
              className="btn-secondary text-sm py-2 min-h-[44px] w-full"
            >
              {locatingFor ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                  Obteniendo ubicación...
                </span>
              ) : (
                <>📍 Mi ubicación</>
              )}
            </button>
          </div>
        </div>

        <div className="app-mobile-card bg-white p-4 md:p-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Origen</label>
                <input
                  type="text"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  onFocus={() => setMapActiveField('pickup')}
                  onBlur={() => setMapActiveField(null)}
                  placeholder="¿De dónde sales?"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Destino</label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  onFocus={() => setMapActiveField('dropoff')}
                  onBlur={() => setMapActiveField(null)}
                  placeholder="¿A dónde vas?"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  required
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-24">
                <label className="block text-sm font-medium text-gray-700 mb-2">Pasajeros</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={seats}
                  onChange={(e) => setSeats(parseInt(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <button type="submit" className="btn-primary">
                Buscar viajes
              </button>
            </div>
          </form>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-8">
          <div className="app-mobile-card p-5 bg-white">
            <div className="text-2xl mb-2">💰</div>
            <h3 className="font-semibold text-gray-900 mb-1">Precios justos</h3>
            <p className="text-sm text-gray-500">Comparte los costos del viaje y ahorra dinero</p>
          </div>
          <div className="app-mobile-card p-5 bg-white">
            <div className="text-2xl mb-2">🌱</div>
            <h3 className="font-semibold text-gray-900 mb-1">Viaja sostenible</h3>
            <p className="text-sm text-gray-500">Reduce tu huella de carbono compartiendo viajes</p>
          </div>
          <div className="app-mobile-card p-5 bg-white">
            <div className="text-2xl mb-2">🤝</div>
            <h3 className="font-semibold text-gray-900 mb-1">Conecta personas</h3>
            <p className="text-sm text-gray-500">Conoce gente nueva en tus viajes</p>
          </div>
        </div>
      </div>
    </div>
  );
}
