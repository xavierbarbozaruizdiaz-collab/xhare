'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase/client';

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
      <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-600 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="inline-block w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mb-4" />
          <p>{authState === 'driver' ? 'Redirigiendo a tus viajes...' : 'Cargando...'}</p>
        </div>
      </div>
    );
  }

  // Landing: no logueado — solo CTA para iniciar sesión (sin mapa ni búsqueda)
  if (authState === 'guest') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-600 via-green-500 to-emerald-600">
        <header className="bg-white/10 backdrop-blur-sm border-b border-white/20">
          <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="text-2xl font-bold text-white">Xhare</Link>
            <Link
              href="/login"
              className="px-4 py-2 bg-white text-green-600 rounded-lg hover:bg-gray-100 transition font-medium"
            >
              Iniciar sesión
            </Link>
          </div>
        </header>
        <div className="container mx-auto px-4 py-20 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Viaja compartiendo
          </h1>
          <p className="text-xl text-green-100 mb-6">
            Conecta con conductores y pasajeros. Viajá más barato y de forma sostenible.
          </p>
          <p className="text-lg text-white/90 mb-10">
            Iniciá sesión para <strong>buscar viajes</strong> como pasajero o para <strong>publicar tu viaje</strong> como conductor.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/login"
              className="px-8 py-4 bg-white text-green-600 rounded-xl font-semibold text-lg hover:bg-gray-100 transition shadow-lg"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/login?signup=1"
              className="px-8 py-4 bg-white/20 text-white border-2 border-white rounded-xl font-semibold text-lg hover:bg-white/30 transition"
            >
              Crear cuenta
            </Link>
          </div>
          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-white">
              <div className="text-3xl mb-3">💰</div>
              <h3 className="font-semibold mb-1">Precios justos</h3>
              <p className="text-sm text-green-100">Compartí costos y ahorrá</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-white">
              <div className="text-3xl mb-3">🌱</div>
              <h3 className="font-semibold mb-1">Viaja sostenible</h3>
              <p className="text-sm text-green-100">Menos huella de carbono</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-white">
              <div className="text-3xl mb-3">🤝</div>
              <h3 className="font-semibold mb-1">Conecta personas</h3>
              <p className="text-sm text-green-100">Conocé gente en el camino</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Pasajero logueado: mapa + búsqueda
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 via-green-500 to-emerald-600">
      <header className="bg-white/10 backdrop-blur-sm border-b border-white/20">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-white">Xhare</Link>
          <div className="flex gap-3">
            <Link
              href="/my-bookings"
              className="px-4 py-2 text-white hover:bg-white/20 rounded-lg transition"
            >
              Mis reservas
            </Link>
            <Link
              href="/my-trip-requests"
              className="px-4 py-2 text-white hover:bg-white/20 rounded-lg transition"
            >
              Mis solicitudes
            </Link>
            <Link
              href="/messages"
              className="px-4 py-2 text-white hover:bg-white/20 rounded-lg transition"
            >
              Mensajes
            </Link>
            <Link
              href="/offer"
              className="px-4 py-2 text-white hover:bg-white/20 rounded-lg transition"
            >
              Viajes a oferta
            </Link>
            <button
              type="button"
              onClick={() => supabase.auth.signOut().then(() => router.push('/'))}
              className="px-4 py-2 bg-white text-green-600 rounded-lg hover:bg-gray-100 transition font-medium"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-4">
            Buscar viajes
          </h1>
          <p className="text-xl text-green-100 mb-4">
            Elegí origen y destino, fecha y pasajeros. Los conductores publican sus rutas y vos reservás.
          </p>
          <p className="mb-6">
            <Link
              href={`/search?date=${new Date().toISOString().split('T')[0]}&seats=1`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white font-medium rounded-xl border border-white/40 transition"
            >
              Ver viajes disponibles
            </Link>
          </p>

          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base font-semibold text-gray-800">
                Elige origen y destino en el mapa
              </h2>
              <p className="text-sm text-gray-500">
                Recogida / Destino en el mapa o «Mi ubicación».
              </p>
            </div>
            <div className="h-[320px] w-full relative bg-gray-100">
              {inlineMapReady ? (
                <MapComponent
                  pickup={originMapPoint}
                  dropoff={destinationMapPoint}
                  onPickupSelect={handleMapSelectOrigin}
                  onDropoffSelect={handleMapSelectDestination}
                  activeMode={mapActiveField}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                  <span className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2" />
                  Cargando mapa...
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
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
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    required
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleUseMyLocation('origin')}
                      disabled={locatingFor !== null}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:border-green-400 hover:text-green-600 transition disabled:opacity-50"
                    >
                      {locatingFor === 'origin' ? (
                        <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <span aria-hidden>📍</span>
                      )}
                      Mi ubicación
                    </button>
                  </div>
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
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    required
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleUseMyLocation('destination')}
                      disabled={locatingFor !== null}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:border-green-400 hover:text-green-600 transition disabled:opacity-50"
                    >
                      {locatingFor === 'destination' ? (
                        <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <span aria-hidden>📍</span>
                      )}
                      Mi ubicación
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Fecha</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Pasajeros</label>
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={seats}
                    onChange={(e) => setSeats(parseInt(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <button
                  type="submit"
                  className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold text-lg mt-6"
                >
                  Buscar viajes
                </button>
              </div>
            </form>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mt-16">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-white">
              <div className="text-4xl mb-4">💰</div>
              <h3 className="text-xl font-semibold mb-2">Precios justos</h3>
              <p className="text-green-100">Comparte los costos del viaje y ahorra dinero</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-white">
              <div className="text-4xl mb-4">🌱</div>
              <h3 className="text-xl font-semibold mb-2">Viaja sostenible</h3>
              <p className="text-green-100">Reduce tu huella de carbono compartiendo viajes</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-white">
              <div className="text-4xl mb-4">🤝</div>
              <h3 className="text-xl font-semibold mb-2">Conecta personas</h3>
              <p className="text-green-100">Conoce gente nueva en tus viajes</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
