'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';
import AppDrawer from '@/components/AppDrawer';

/** Acorta dirección para la lista; título completo en detalle. */
function shortLabel(label: string | null | undefined, maxChars = 42): string {
  if (label == null || typeof label !== 'string') return '—';
  const t = String(label).trim();
  return t.length <= maxChars ? t : t.slice(0, maxChars) + '…';
}

/** Badge de estado con color y texto legible. */
function statusConfig(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: 'Borrador', className: 'bg-gray-100 text-gray-700' },
    published: { label: 'Publicado', className: 'bg-green-100 text-green-800' },
    booked: { label: 'Con reservas', className: 'bg-amber-100 text-amber-800' },
    en_route: { label: 'En camino', className: 'bg-blue-100 text-blue-800' },
    completed: { label: 'Completado', className: 'bg-gray-100 text-gray-600' },
    cancelled: { label: 'Cancelado', className: 'bg-red-100 text-red-800' },
  };
  return map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

export default function MyRidesPage() {
  const router = useRouter();
  const [rides, setRides] = useState<any[]>([]);
  const [reservedByRide, setReservedByRide] = useState<Record<string, number>>({});
  const [expectedAmountByRide, setExpectedAmountByRide] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      if (profile?.role !== 'driver') {
        router.push('/my-bookings');
        return;
      }
      const { data } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', session.user.id)
        .order('departure_time', { ascending: false })
        .limit(100);
      setRides(data || []);

      const rideIds = (data || []).map((r: any) => r.id).filter(Boolean);
      if (rideIds.length > 0) {
        const { data: bks } = await supabase
          .from('bookings')
          .select('ride_id, seats_count, price_paid')
          .in('ride_id', rideIds)
          .neq('status', 'cancelled');
        const reservedMap: Record<string, number> = {};
        const amountMap: Record<string, number> = {};
        (bks || []).forEach((b: any) => {
          const rid = b.ride_id;
          reservedMap[rid] = (reservedMap[rid] ?? 0) + Number(b.seats_count ?? 0);
          amountMap[rid] = (amountMap[rid] ?? 0) + Number(b.price_paid ?? 0);
        });
        setReservedByRide(reservedMap);
        setExpectedAmountByRide(amountMap);
      }
    } catch (error) {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;

  const now = new Date();
  const upcomingRides = rides.filter((r: any) => {
    const status = r.status ?? '';
    const dep = r.departure_time ? new Date(r.departure_time) : null;
    if (status === 'completed' || status === 'cancelled') return false;
    if (dep && dep < now) return false;
    return true;
  });
  const finishedRides = rides.filter((r: any) => {
    const status = r.status ?? '';
    const dep = r.departure_time ? new Date(r.departure_time) : null;
    if (status === 'completed') return true;
    if (status === 'cancelled') return true;
    if (dep && dep < now) return true;
    return false;
  });

  function renderRideList(list: any[], showReagendar: boolean) {
    return list.map((r: any) => {
      const status = statusConfig(r.status);
      const totalSeats = Number(r.total_seats ?? r.available_seats ?? 15);
      const reserved = reservedByRide[r.id] ?? 0;
      const remaining = Math.max(0, totalSeats - reserved);
      const sc = status?.className ?? '';
      const chipClass =
        sc.includes('green') ? 'chip-success' :
        sc.includes('amber') ? 'chip-warning' :
        sc.includes('blue') ? 'chip-info' :
        sc.includes('red') ? 'chip-error' : 'chip-neutral';
      return (
        <li key={r.id}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/rides/${r.id}`)}
            onKeyDown={(e) => e.key === 'Enter' && router.push(`/rides/${r.id}`)}
            className="block bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:border-green-300 hover:shadow-md transition cursor-pointer"
          >
            <div className="flex justify-between items-start gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate" title={r.origin_label ?? ''}>
                  {shortLabel(r.origin_label)}
                </p>
                <p className="text-sm text-gray-500 mt-0.5 truncate" title={r.destination_label ?? ''}>
                  → {shortLabel(r.destination_label)}
                </p>
              </div>
              <span className={`flex-shrink-0 ${chipClass}`}>{status.label}</span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
              <span title={r.departure_time ?? ''}>
                📅 {formatDate(r.departure_time)} · {formatTime(r.departure_time)}
              </span>
              {!showReagendar && (
                <span>
                  💺 {remaining} plazas{reserved > 0 ? ` (${reserved} reservados)` : ''}
                </span>
              )}
              {(expectedAmountByRide[r.id] ?? 0) > 0 && (
                <span className="font-medium text-green-700">
                  A cobrar: {Number(expectedAmountByRide[r.id]).toLocaleString('es-PY')} PYG
                </span>
              )}
              {((expectedAmountByRide[r.id] ?? 0) === 0 && r.price_per_seat != null && Number(r.price_per_seat) > 0) && !showReagendar && (
                <span>{Number(r.price_per_seat).toLocaleString('es-PY')} PYG / asiento</span>
              )}
            </div>
            <div className="mt-3 flex gap-4 items-center flex-wrap">
              <span className="text-sm font-medium text-green-600">Ver viaje →</span>
              {!showReagendar && (
                <Link
                  href={`/rides/${r.id}/edit`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm btn-tertiary py-0"
                >
                  Editar
                </Link>
              )}
              {showReagendar && (
                <Link
                  href={`/publish?from_ride_id=${encodeURIComponent(r.id)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-green-600 hover:text-green-700"
                >
                  Volver a agendar
                </Link>
              )}
            </div>
          </div>
        </li>
      );
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <ul className="space-y-0.5">
          <li className="flex items-center gap-2 py-3 pb-2">
            <UserRoleBadge />
          </li>
          <li>
            <Link href="/driver/trip-requests" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Solicitudes de trayecto
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
          <li>
            <Link href="/my-rides/finalizados" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Viajes finalizados
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

      <header className="bg-white border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40 shadow-sm">
        <div className="flex items-center justify-between gap-2 py-2 min-h-[48px]">
          <Link href="/my-rides" className="text-lg font-bold text-green-600 shrink-0">Xhare</Link>
          <div className="flex items-center gap-2">
            <Link href="/publish" className="btn-primary text-sm py-2 px-3 shrink-0">
              Publicar viaje
            </Link>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl text-gray-600 hover:bg-gray-100 flex items-center justify-center"
              aria-label="Menú"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
        <div className="hidden lg:flex flex-wrap items-center gap-2 pb-2">
          <span className="hidden lg:inline"><UserRoleBadge /></span>
          <Link href="/driver/trip-requests" className="tab-segment text-sm">Solicitudes</Link>
          <Link href="/messages" className="tab-segment text-sm">Mensajes</Link>
          <Link href="/offer" className="tab-segment text-sm">Oferta</Link>
          <button type="button" onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/'; })} className="btn-tertiary text-sm">
            Cerrar sesión
          </button>
        </div>
      </header>

      <div className="app-mobile-px py-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Mis Viajes</h1>
          {rides.length > 0 && (
            <p className="text-sm text-gray-500">{rides.length} viaje{rides.length !== 1 ? 's' : ''}</p>
          )}
        </div>

        {rides.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
            <div className="text-5xl mb-4 opacity-60">🚗</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Aún no publicaste ningún viaje</h2>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              Publicá tu ruta, elegí fecha y precio, y los pasajeros podrán reservar asientos.
            </p>
            <Link href="/publish" className="btn-primary">
              Publicar mi primer viaje
            </Link>
          </div>
        ) : (
          <>
            {upcomingRides.length > 0 ? (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  Próximos ({upcomingRides.length})
                </h2>
                <ul className="space-y-4">{renderRideList(upcomingRides, false)}</ul>
              </section>
            ) : (
              <p className="text-gray-500 text-center py-6">
                No tenés viajes próximos. Los finalizados están en el menú → <Link href="/my-rides/finalizados" className="text-green-600 font-medium hover:underline">Viajes finalizados</Link>.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
