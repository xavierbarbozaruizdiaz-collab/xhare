'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';
import AppDrawer from '@/components/AppDrawer';

function shortLabel(label: string | null | undefined, maxChars = 42): string {
  if (!label) return '—';
  const t = String(label).trim();
  return t.length <= maxChars ? t : t.slice(0, maxChars) + '…';
}

function bookingStatusConfig(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800' },
    confirmed: { label: 'Confirmada', className: 'bg-green-100 text-green-800' },
    completed: { label: 'Completado', className: 'bg-gray-100 text-gray-700' },
    cancelled: { label: 'Cancelada', className: 'bg-red-100 text-red-800' },
  };
  return map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
}

function isBookingFinished(b: any): boolean {
  if (b.status === 'completed' || b.status === 'cancelled') return true;
  const dep = b.ride?.departure_time;
  if (dep && new Date(dep) < new Date()) return true;
  return false;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

/** Fecha por defecto para "Volver a agendar": mañana en YYYY-MM-DD */
function defaultSearchDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function MyBookingsFinalizadosPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    loadBookings();
  }, []);

  async function loadBookings() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }
      const selectWithSeats = `
          id, ride_id, seats_count, price_paid, status, pickup_label, dropoff_label, selected_seat_ids,
          ride:rides(
            id, origin_label, destination_label, departure_time, price_per_seat,
            driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
          )
        `;
      const selectWithoutSeats = `
          id, ride_id, seats_count, price_paid, status, pickup_label, dropoff_label,
          ride:rides(
            id, origin_label, destination_label, departure_time, price_per_seat,
            driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
          )
        `;
      let rows: any[] = [];
      const res1 = await supabase
        .from('bookings')
        .select(selectWithSeats)
        .eq('passenger_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (res1.error?.code === '42703' || res1.error?.message?.includes('column')) {
        const res2 = await supabase
          .from('bookings')
          .select(selectWithoutSeats)
          .eq('passenger_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        rows = (res2.data ?? []).map((b: any) => ({ ...b, selected_seat_ids: null }));
      } else {
        rows = res1.data ?? [];
      }
      const normalized = rows.map((b: any) => ({
        ...b,
        ride: b.ride
          ? {
              ...b.ride,
              driver: Array.isArray(b.ride?.driver) ? b.ride.driver[0] ?? null : b.ride.driver ?? null,
            }
          : null,
      }));
      const finished = normalized.filter((b: any) => isBookingFinished(b));
      setBookings(finished);
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;

  const searchDate = defaultSearchDate();

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <ul className="space-y-0.5">
          <li className="flex items-center gap-2 py-3 pb-2">
            <UserRoleBadge />
          </li>
          <li>
            <Link href="/my-bookings" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Mis reservas
            </Link>
          </li>
          <li>
            <Link href="/my-bookings/finalizados" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Viajes finalizados
            </Link>
          </li>
          <li>
            <Link href="/my-trip-requests" onClick={() => setDrawerOpen(false)} className="block px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-100 font-medium min-h-[44px] flex items-center">
              Mis solicitudes
            </Link>
          </li>
          <li className="pt-3 mt-2 border-t border-gray-200">
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
          <Link href="/my-bookings" className="text-sm font-medium text-green-600 hover:text-green-700">← Mis reservas</Link>
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

      <div className="app-mobile-px py-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Viajes finalizados</h1>
        <p className="text-sm text-gray-500 mb-6">
          Reservas completadas, canceladas o cuya fecha ya pasó. Podés buscar un viaje similar con &quot;Volver a agendar&quot;.
        </p>

        {bookings.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <p className="text-gray-500">
              Aún no tenés viajes finalizados. Cuando completes una reserva o pase la fecha del viaje, aparecerán acá.
            </p>
            <Link href="/my-bookings" className="mt-4 inline-block px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700">
              Volver a Mis reservas
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b: any) => {
              const ride = b.ride;
              const driver = ride?.driver;
              const sc = bookingStatusConfig(b.status);
              const origin = (ride?.origin_label ?? '').trim();
              const destination = (ride?.destination_label ?? '').trim();
              const searchParams = new URLSearchParams();
              if (origin) searchParams.set('origin', origin);
              if (destination) searchParams.set('destination', destination);
              searchParams.set('date', searchDate);
              const searchHref = `/search?${searchParams.toString()}`;

              return (
                <div key={b.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900" title={ride?.origin_label}>
                          {shortLabel(ride?.origin_label)}
                        </p>
                        <p className="text-sm text-gray-600 mt-0.5" title={ride?.destination_label}>
                          → {shortLabel(ride?.destination_label)}
                        </p>
                      </div>
                      <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${sc.className}`}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
                      <span>{formatDate(ride?.departure_time)}</span>
                      <span>{formatTime(ride?.departure_time)}</span>
                      <span className="font-medium text-green-700">
                        {b.seats_count} asiento{b.seats_count !== 1 ? 's' : ''} · {Number(b.price_paid ?? 0).toLocaleString('es-PY')} PYG
                      </span>
                    </div>
                    {driver && (
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm font-medium overflow-hidden">
                          {driver.avatar_url ? (
                            <img src={driver.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            (driver.full_name || 'C').charAt(0).toUpperCase()
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-700">{driver.full_name || 'Conductor'}</span>
                        {driver.rating_average != null && (
                          <span className="text-sm text-gray-500">★ {Number(driver.rating_average).toFixed(1)}</span>
                        )}
                      </div>
                    )}
                    {(b.pickup_label || b.dropoff_label) && (
                      <div className="text-xs text-gray-500 space-y-0.5 mb-3">
                        {b.pickup_label && <p><span className="text-green-600">Recogida:</span> {shortLabel(b.pickup_label, 55)}</p>}
                        {b.dropoff_label && <p><span className="text-amber-600">Bajada:</span> {shortLabel(b.dropoff_label, 55)}</p>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                      <Link
                        href={`/rides/${b.ride_id}`}
                        className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                      >
                        Ver viaje
                      </Link>
                      <Link
                        href={searchHref}
                        className="inline-flex items-center px-4 py-2 border border-green-600 text-green-700 text-sm font-medium rounded-lg hover:bg-green-50"
                      >
                        Volver a agendar
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
