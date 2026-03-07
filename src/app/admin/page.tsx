'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAdminAuth } from './AdminAuthContext';

type DashboardData = {
  uberpool: {
    totalViajesPublicados: number;
    viajesEnCurso: number;
    viajesCompletados: number;
    totalReservas: number;
    asientosOcupados: number;
    tasaCancelacion: number;
    ratingPromedioConductor: number | null;
    ratingPromedioPasajero: number | null;
    activeRides: any[];
  };
  indriver: {
    solicitudesCreadas: number;
    disponibilidadesCreadas: number;
    ofertasEnviadas: number;
    ofertasAceptadas: number;
    viajesCreadosDesdeOferta: number;
    precioPromedioOfertadoDriver: number | null;
    precioPromedioOfertadoPassenger: number | null;
  };
  profiles: {
    pendingDrivers: number;
    totalDrivers: number;
    totalPassengersProfile: number;
  };
};

export default function AdminDashboardPage() {
  const { accessToken, ready, refetch, isAdmin } = useAdminAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    if (hasFetchedRef.current) return;
    if (!accessToken) return;
    hasFetchedRef.current = true;

    (async () => {
      try {
        const doFetch = (t: string) =>
          fetch('/api/admin/dashboard', {
            headers: { Authorization: `Bearer ${t}`, 'x-admin-token': t },
            credentials: 'include',
          });

        let res = await doFetch(accessToken);
        if (res.status === 401) {
          const newToken = await refetch();
          if (newToken) res = await doFetch(newToken);
        }
        if (!res.ok) {
          setError(res.status === 401 ? 'No autorizado' : res.status === 403 ? 'Sin permisos' : 'Error al cargar');
          setLoading(false);
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError('Error de conexión');
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, isAdmin, accessToken, refetch]);

  if (loading) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <p className="text-gray-500">Cargando…</p>
      </div>
    );
  }

  if (!isAdmin && (error || !data)) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-6 text-center">
          <p className="text-gray-700">{error ?? 'Sin datos'}</p>
          <p className="mt-1 text-sm text-gray-500">Tu usuario debe tener rol administrador en la base de datos.</p>
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

  if (isAdmin && (error || !data)) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <p className="text-sm text-gray-500 mb-4">No se pudieron cargar las métricas del inicio. Usá el menú para ir a Conductores, Billing, etc.</p>
        <button
          type="button"
          onClick={async () => {
            setError(null);
            setLoading(true);
            const t = await refetch();
            if (!t) { setLoading(false); return; }
            try {
              const r = await fetch('/api/admin/dashboard', { headers: { Authorization: `Bearer ${t}`, 'x-admin-token': t }, credentials: 'include' });
              if (r.ok) { const json = await r.json(); setData(json); setError(null); } else setError('Error al cargar');
            } catch { setError('Error de conexión'); }
            setLoading(false);
          }}
          className="btn-secondary text-sm"
        >
          Reintentar métricas
        </button>
        <div className="app-mobile-card p-6 mt-6">
          <h2 className="font-semibold text-gray-900 mb-2">Accesos rápidos</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/admin/drivers" className="text-green-600 hover:underline">
                Conductores
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
            <li>
              <Link href="/admin/billing" className="text-green-600 hover:underline">
                Billing
              </Link>
            </li>
            <li>
              <Link href="/admin/pricing" className="text-green-600 hover:underline">
                Pricing
              </Link>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { uberpool, indriver, profiles } = data;

  return (
    <div>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>

      {/* Perfiles / Accesos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Link
          href="/admin/drivers"
          className="app-mobile-card p-4 hover:border-green-300 hover:shadow transition block"
        >
          <p className="text-gray-500 text-sm">Solicitudes de conductores</p>
          <p className="text-2xl font-bold text-gray-900">{profiles.pendingDrivers}</p>
          <p className="text-xs text-green-600 mt-1">Aprobar o rechazar</p>
        </Link>
        <div className="app-mobile-card p-4">
          <p className="text-gray-500 text-sm">Conductores aprobados</p>
          <p className="text-2xl font-bold text-gray-900">{profiles.totalDrivers}</p>
        </div>
        <div className="app-mobile-card p-4">
          <p className="text-gray-500 text-sm">Pasajeros</p>
          <p className="text-2xl font-bold text-gray-900">{profiles.totalPassengersProfile}</p>
        </div>
        <div className="app-mobile-card p-4">
          <p className="text-gray-500 text-sm">Viajes (UberPool)</p>
          <p className="text-2xl font-bold text-gray-900">
            {uberpool.totalViajesPublicados + uberpool.viajesEnCurso + uberpool.viajesCompletados}
          </p>
        </div>
      </div>

      {/* Sección UberPool */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">UberPool (viajes publicados + reservas)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Publicados</p>
            <p className="text-xl font-bold text-gray-900">{uberpool.totalViajesPublicados}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">En curso</p>
            <p className="text-xl font-bold text-blue-600">{uberpool.viajesEnCurso}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Completados</p>
            <p className="text-xl font-bold text-gray-700">{uberpool.viajesCompletados}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Reservas</p>
            <p className="text-xl font-bold text-gray-900">{uberpool.totalReservas}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Asientos ocupados</p>
            <p className="text-xl font-bold text-gray-900">{uberpool.asientosOcupados}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Tasa cancelación %</p>
            <p className="text-xl font-bold text-gray-900">{uberpool.tasaCancelacion}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">★ Conductor</p>
            <p className="text-xl font-bold text-gray-900">
              {uberpool.ratingPromedioConductor ?? '—'}
            </p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">★ Pasajero</p>
            <p className="text-xl font-bold text-gray-900">
              {uberpool.ratingPromedioPasajero ?? '—'}
            </p>
          </div>
        </div>
        {uberpool.activeRides.length > 0 && (
          <div className="mt-4 app-mobile-card p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Viajes activos (publicado / en curso)</p>
            <ul className="text-sm text-gray-600 space-y-1">
              {uberpool.activeRides.slice(0, 10).map((r: any) => (
                <li key={r.id}>
                  {r.origin_label ?? 'Origen'} → {r.destination_label ?? 'Destino'} · {r.status}
                  {r.driver?.full_name ? ` · ${r.driver.full_name}` : ''}
                </li>
              ))}
              {uberpool.activeRides.length > 10 && (
                <li className="text-gray-400">+ {uberpool.activeRides.length - 10} más</li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* Sección InDriver */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">InDriver (busco/tengo + ofertas)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Solicitudes creadas</p>
            <p className="text-xl font-bold text-gray-900">{indriver.solicitudesCreadas}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Disponibilidades creadas</p>
            <p className="text-xl font-bold text-gray-900">{indriver.disponibilidadesCreadas}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Ofertas enviadas</p>
            <p className="text-xl font-bold text-gray-900">{indriver.ofertasEnviadas}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Ofertas aceptadas</p>
            <p className="text-xl font-bold text-green-700">{indriver.ofertasAceptadas}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Viajes desde oferta</p>
            <p className="text-xl font-bold text-gray-900">{indriver.viajesCreadosDesdeOferta}</p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Precio prom. oferta (conductor)</p>
            <p className="text-xl font-bold text-gray-900">
              {indriver.precioPromedioOfertadoDriver != null ? `${indriver.precioPromedioOfertadoDriver}` : '—'}
            </p>
          </div>
          <div className="app-mobile-card p-4">
            <p className="text-gray-500 text-xs">Precio prom. oferta (pasajero)</p>
            <p className="text-xl font-bold text-gray-900">
              {indriver.precioPromedioOfertadoPassenger != null ? `${indriver.precioPromedioOfertadoPassenger}` : '—'}
            </p>
          </div>
        </div>
      </section>

      <div className="app-mobile-card p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Accesos rápidos</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/admin/drivers" className="text-green-600 hover:underline">
              Solicitudes de conductores
            </Link>
            — Aprobar o rechazar registros como chofer
          </li>
          <li>
            <Link href="/admin/passengers" className="text-green-600 hover:underline">
              Pasajeros
            </Link>
            — Listado de usuarios pasajeros
          </li>
          <li>
            <Link href="/admin/rides" className="text-green-600 hover:underline">
              Viajes
            </Link>
            — Todos los viajes publicados
          </li>
          <li>
            <Link href="/admin/users" className="text-green-600 hover:underline">
              Usuarios
            </Link>
            — Todos los usuarios y roles
          </li>
        </ul>
      </div>
    </div>
  );
}
