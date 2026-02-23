'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

/** Acorta dirección para la lista; título completo en detalle. */
function shortLabel(label: string | null, maxChars = 42): string {
  if (!label) return '—';
  const t = label.trim();
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
        .limit(50);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="container mx-auto flex justify-between items-center">
          <Link href="/my-rides" className="text-2xl font-bold text-green-600">Xhare</Link>
          <div className="flex items-center gap-3">
            <UserRoleBadge />
            <Link
              href="/driver/trip-requests"
              className="px-4 py-2.5 text-gray-700 hover:text-green-600 font-medium"
            >
              Solicitudes de trayecto
            </Link>
            <Link href="/messages" className="px-4 py-2.5 text-gray-700 hover:text-green-600 font-medium">
              Mensajes
            </Link>
            <Link href="/offer" className="px-4 py-2.5 text-gray-700 hover:text-green-600 font-medium">
              Viajes a oferta
            </Link>
            <Link
              href="/publish"
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 shadow-sm"
            >
              Publicar viaje
            </Link>
            <button
              onClick={() => supabase.auth.signOut().then(() => router.push('/'))}
              className="px-4 py-2 text-gray-600 hover:text-green-600 font-medium"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Mis Viajes</h1>
          {rides.length > 0 && (
            <p className="text-sm text-gray-500">{rides.length} viaje{rides.length !== 1 ? 's' : ''}</p>
          )}
        </div>

        {rides.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <div className="text-5xl mb-4 opacity-60">🚗</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Aún no publicaste ningún viaje</h2>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              Publicá tu ruta, elegí fecha y precio, y los pasajeros podrán reservar asientos.
            </p>
            <Link
              href="/publish"
              className="inline-block px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700"
            >
              Publicar mi primer viaje
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {rides.map((r: any) => {
              const status = statusConfig(r.status);
              const totalSeats = Number(r.total_seats ?? r.available_seats ?? 15);
              const reserved = reservedByRide[r.id] ?? 0;
              const remaining = Math.max(0, totalSeats - reserved);
              return (
                <li key={r.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/rides/${r.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && router.push(`/rides/${r.id}`)}
                    className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-green-300 hover:shadow-md transition cursor-pointer"
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
                      <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                      <span title={r.departure_time ?? ''}>
                        📅 {formatDate(r.departure_time)} · {formatTime(r.departure_time)}
                      </span>
                      <span>
                        💺 {remaining} plazas{reserved > 0 ? ` (${reserved} reservados)` : ''}
                      </span>
                      {(expectedAmountByRide[r.id] ?? 0) > 0 && (
                        <span className="font-medium text-green-700">
                          A cobrar por reservas: {Number(expectedAmountByRide[r.id]).toLocaleString('es-PY')} PYG
                        </span>
                      )}
                      {((expectedAmountByRide[r.id] ?? 0) === 0 && r.price_per_seat != null && Number(r.price_per_seat) > 0) && (
                        <span>${Number(r.price_per_seat).toLocaleString('es-PY')} / asiento</span>
                      )}
                    </div>
                    <div className="mt-3 flex gap-3 items-center">
                      <span className="text-sm text-green-600 font-medium">Ver viaje →</span>
                      <Link
                        href={`/rides/${r.id}/edit`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm text-gray-600 hover:text-green-600 font-medium"
                      >
                        Editar
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
