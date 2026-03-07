'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuth } from './AdminAuthContext';

type BlockStatus = 'idle' | 'loading' | 'success' | 'error';

type UberpoolData = {
  totalViajesPublicados: number;
  viajesEnCurso: number;
  viajesCompletados: number;
  totalReservas: number;
  asientosOcupados: number;
  tasaCancelacion: number;
  activeRides: { id: string; origin_label?: string; destination_label?: string; status: string; driver?: { full_name?: string } }[];
};

type RatingsData = {
  ratingPromedioConductor: number | null;
  ratingPromedioPasajero: number | null;
};

type IndriverData = {
  solicitudesCreadas: number;
  disponibilidadesCreadas: number;
  ofertasEnviadas: number;
  ofertasAceptadas: number;
  viajesCreadosDesdeOferta: number;
  precioPromedioOfertadoDriver: number | null;
  precioPromedioOfertadoPassenger: number | null;
};

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'x-admin-token': token,
});

export default function AdminDashboardPage() {
  const { accessToken, ready, refetch, isAdmin } = useAdminAuth();

  const [uberpool, setUberpool] = useState<{ status: BlockStatus; data: UberpoolData | null; error: string | null }>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [ratings, setRatings] = useState<{ status: BlockStatus; data: RatingsData | null; error: string | null }>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [indriver, setIndriver] = useState<{ status: BlockStatus; data: IndriverData | null; error: string | null }>({
    status: 'idle',
    data: null,
    error: null,
  });

  const [ratingsExpanded, setRatingsExpanded] = useState(false);
  const [indriverExpanded, setIndriverExpanded] = useState(false);

  const fetchBlock = useCallback(
    async <T,>(
      endpoint: string,
      setState: React.Dispatch<React.SetStateAction<{ status: BlockStatus; data: T | null; error: string | null }>>
    ) => {
      let token = accessToken;
      if (!token) token = await refetch();
      if (!token) {
        setState((s) => ({ ...s, status: 'error', error: 'Sesión no disponible' }));
        return;
      }
      setState((s) => ({ ...s, status: 'loading', error: null }));
      const doFetch = (t: string) =>
        fetch(endpoint, { headers: authHeaders(t), credentials: 'include' as RequestCredentials });
      let res = await doFetch(token);
      if (res.status === 401) {
        const newToken = await refetch();
        if (newToken) res = await doFetch(newToken);
      }
      if (!res.ok) {
        const errMsg = res.status === 401 ? 'No autorizado' : res.status === 403 ? 'Sin permisos' : 'Error al cargar';
        setState((s) => ({ ...s, status: 'error', error: errMsg }));
        return;
      }
      try {
        const json = await res.json();
        setState({ status: 'success', data: json, error: null });
      } catch {
        setState((s) => ({ ...s, status: 'error', error: 'Error de conexión' }));
      }
    },
    [accessToken, refetch]
  );

  const fetchUberpool = useCallback(() => fetchBlock('/api/admin/dashboard/uberpool', setUberpool), [fetchBlock]);
  const fetchRatings = useCallback(() => fetchBlock('/api/admin/dashboard/ratings', setRatings), [fetchBlock]);
  const fetchIndriver = useCallback(() => fetchBlock('/api/admin/dashboard/indriver', setIndriver), [fetchBlock]);

  useEffect(() => {
    if (!ready || !isAdmin || !accessToken) return;
    fetchUberpool();
  }, [ready, isAdmin, accessToken, fetchUberpool]);

  useEffect(() => {
    if (ratingsExpanded && ratings.status === 'idle') fetchRatings();
  }, [ratingsExpanded, ratings.status, fetchRatings]);

  useEffect(() => {
    if (indriverExpanded && indriver.status === 'idle') fetchIndriver();
  }, [indriverExpanded, indriver.status, fetchIndriver]);

  if (!ready) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <p className="text-gray-500">Cargando…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-6 text-center">
          <p className="text-gray-700">Tu usuario debe tener rol administrador en la base de datos.</p>
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/login?next=/admin" className="btn-primary text-sm">
              Iniciar sesión
            </Link>
            <Link href="/admin" className="text-sm text-green-600 hover:text-green-700 font-medium">
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const uberpoolData = uberpool.data;

  return (
    <div>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>

      {/* Sección UberPool (6 métricas + activos) */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">UberPool (viajes + reservas)</h2>
        {uberpool.status === 'loading' && !uberpoolData && (
          <p className="text-gray-500 text-sm">Cargando…</p>
        )}
        {uberpool.status === 'error' && !uberpoolData && (
          <div className="app-mobile-card p-4 border-red-200 bg-red-50/30">
            <p className="text-red-600">{uberpool.error}</p>
            <button type="button" onClick={fetchUberpool} className="btn-secondary text-sm mt-2">
              Reintentar
            </button>
          </div>
        )}
        {uberpoolData && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="app-mobile-card p-4">
                <p className="text-gray-500 text-xs">Publicados</p>
                <p className="text-xl font-bold text-gray-900">{uberpoolData.totalViajesPublicados}</p>
              </div>
              <div className="app-mobile-card p-4">
                <p className="text-gray-500 text-xs">En curso</p>
                <p className="text-xl font-bold text-blue-600">{uberpoolData.viajesEnCurso}</p>
              </div>
              <div className="app-mobile-card p-4">
                <p className="text-gray-500 text-xs">Completados</p>
                <p className="text-xl font-bold text-gray-700">{uberpoolData.viajesCompletados}</p>
              </div>
              <div className="app-mobile-card p-4">
                <p className="text-gray-500 text-xs">Reservas</p>
                <p className="text-xl font-bold text-gray-900">{uberpoolData.totalReservas}</p>
              </div>
              <div className="app-mobile-card p-4">
                <p className="text-gray-500 text-xs">Asientos ocupados</p>
                <p className="text-xl font-bold text-gray-900">{uberpoolData.asientosOcupados}</p>
              </div>
              <div className="app-mobile-card p-4">
                <p className="text-gray-500 text-xs">Tasa cancelación %</p>
                <p className="text-xl font-bold text-gray-900">{uberpoolData.tasaCancelacion}</p>
              </div>
            </div>
            {uberpoolData.activeRides.length > 0 && (
              <div className="mt-4 app-mobile-card p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Viajes activos</p>
                <ul className="text-sm text-gray-600 space-y-1">
                  {uberpoolData.activeRides.slice(0, 10).map((r) => (
                    <li key={r.id}>
                      {r.origin_label ?? 'Origen'} → {r.destination_label ?? 'Destino'} · {r.status}
                      {r.driver?.full_name ? ` · ${r.driver.full_name}` : ''}
                    </li>
                  ))}
                  {uberpoolData.activeRides.length > 10 && (
                    <li className="text-gray-400">+ {uberpoolData.activeRides.length - 10} más</li>
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* Colapsable: Valoraciones */}
      <section className="mb-8">
        <button
          type="button"
          onClick={() => setRatingsExpanded((e) => !e)}
          className="flex items-center justify-between w-full text-left text-lg font-semibold text-gray-900 mb-2 py-2 border-b border-gray-200"
        >
          Valoraciones (★ Conductor / ★ Pasajero)
          <span className="text-gray-500">{ratingsExpanded ? '▼' : '▶'}</span>
        </button>
        {ratingsExpanded && (
          <>
            {ratings.status === 'idle' && (
              <p className="text-gray-500 text-sm">Cargando…</p>
            )}
            {ratings.status === 'loading' && (
              <p className="text-gray-500 text-sm">Cargando…</p>
            )}
            {ratings.status === 'error' && (
              <div className="app-mobile-card p-4 border-red-200 bg-red-50/30">
                <p className="text-red-600">{ratings.error}</p>
                <button type="button" onClick={fetchRatings} className="btn-secondary text-sm mt-2">
                  Reintentar
                </button>
              </div>
            )}
            {ratings.status === 'success' && ratings.data && (
              <div className="grid grid-cols-2 gap-4">
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">★ Conductor</p>
                  <p className="text-xl font-bold text-gray-900">{ratings.data.ratingPromedioConductor ?? '—'}</p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">★ Pasajero</p>
                  <p className="text-xl font-bold text-gray-900">{ratings.data.ratingPromedioPasajero ?? '—'}</p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Colapsable: InDriver */}
      <section className="mb-8">
        <button
          type="button"
          onClick={() => setIndriverExpanded((e) => !e)}
          className="flex items-center justify-between w-full text-left text-lg font-semibold text-gray-900 mb-2 py-2 border-b border-gray-200"
        >
          InDriver (busco/tengo + ofertas)
          <span className="text-gray-500">{indriverExpanded ? '▼' : '▶'}</span>
        </button>
        {indriverExpanded && (
          <>
            {indriver.status === 'idle' && <p className="text-gray-500 text-sm">Cargando…</p>}
            {indriver.status === 'loading' && <p className="text-gray-500 text-sm">Cargando…</p>}
            {indriver.status === 'error' && (
              <div className="app-mobile-card p-4 border-red-200 bg-red-50/30">
                <p className="text-red-600">{indriver.error}</p>
                <button type="button" onClick={fetchIndriver} className="btn-secondary text-sm mt-2">
                  Reintentar
                </button>
              </div>
            )}
            {indriver.status === 'success' && indriver.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Solicitudes creadas</p>
                  <p className="text-xl font-bold text-gray-900">{indriver.data.solicitudesCreadas}</p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Disponibilidades creadas</p>
                  <p className="text-xl font-bold text-gray-900">{indriver.data.disponibilidadesCreadas}</p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Ofertas enviadas</p>
                  <p className="text-xl font-bold text-gray-900">{indriver.data.ofertasEnviadas}</p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Ofertas aceptadas</p>
                  <p className="text-xl font-bold text-green-700">{indriver.data.ofertasAceptadas}</p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Viajes desde oferta</p>
                  <p className="text-xl font-bold text-gray-900">{indriver.data.viajesCreadosDesdeOferta}</p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Precio prom. (conductor)</p>
                  <p className="text-xl font-bold text-gray-900">
                    {indriver.data.precioPromedioOfertadoDriver != null ? indriver.data.precioPromedioOfertadoDriver : '—'}
                  </p>
                </div>
                <div className="app-mobile-card p-4">
                  <p className="text-gray-500 text-xs">Precio prom. (pasajero)</p>
                  <p className="text-xl font-bold text-gray-900">
                    {indriver.data.precioPromedioOfertadoPassenger != null ? indriver.data.precioPromedioOfertadoPassenger : '—'}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div className="app-mobile-card p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Accesos rápidos</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/admin/drivers" className="text-green-600 hover:underline">
              Solicitudes de conductores
            </Link>
            — Aprobar o rechazar
          </li>
          <li>
            <Link href="/admin/passengers" className="text-green-600 hover:underline">
              Pasajeros
            </Link>
          </li>
          <li>
            <Link href="/admin/rides" className="text-green-600 hover:underline">
              Viajes
            </Link>
          </li>
          <li>
            <Link href="/admin/users" className="text-green-600 hover:underline">
              Usuarios
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
