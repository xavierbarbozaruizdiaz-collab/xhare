'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

export default function MyBookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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
      let res = await supabase
        .from('bookings')
        .select(`
          id, ride_id, seats_count, price_paid, status, pickup_label, dropoff_label, selected_seat_ids,
          ride:rides(
            id, origin_label, destination_label, departure_time, price_per_seat,
            driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
          )
        `)
        .eq('passenger_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (res.error?.code === '42703' || res.error?.message?.includes('column')) {
        res = await supabase
          .from('bookings')
          .select(`
            id, ride_id, seats_count, price_paid, status, pickup_label, dropoff_label,
            ride:rides(
              id, origin_label, destination_label, departure_time, price_per_seat,
              driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
            )
          `)
          .eq('passenger_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50);
      }
      setBookings(res.data || []);
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(bookingId: string) {
    setCancellingId(bookingId);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('passenger_id', (await supabase.auth.getUser()).data.user?.id);
      if (error) throw error;
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' } : b));
    } catch {
      // Podrías mostrar un toast
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm p-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold text-green-600">Xhare</Link>
        <div className="flex items-center gap-4">
          <UserRoleBadge />
          <Link href="/my-trip-requests" className="px-4 py-2 text-gray-700 hover:text-green-600">
            Mis solicitudes
          </Link>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/'))} className="px-4 py-2 text-gray-700 hover:text-green-600">
            Cerrar sesión
          </button>
        </div>
      </header>
      <div className="container mx-auto p-4 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">Mis Reservas</h1>
        {bookings.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500 mb-4">No tenés reservas.</p>
            <Link href="/search" className="inline-flex items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700">
              Buscar viajes
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b: any) => {
              const ride = b.ride;
              const driver = ride?.driver;
              const sc = bookingStatusConfig(b.status);
              const canCancelOrEdit = b.status === 'pending' || b.status === 'confirmed';
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
                    {Array.isArray(b.selected_seat_ids) && b.selected_seat_ids.length > 0 && (
                      <p className="text-sm text-gray-600 mb-3">
                        <span className="font-medium text-gray-700">Asientos:</span> {b.selected_seat_ids.join(', ')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                      <Link
                        href={`/rides/${b.ride_id}`}
                        className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                      >
                        Ver viaje
                      </Link>
                      {canCancelOrEdit && (
                        <>
                          <Link
                            href={`/rides/${b.ride_id}/reservar?edit=1`}
                            className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
                          >
                            Editar
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleCancel(b.id)}
                            disabled={cancellingId === b.id}
                            className="inline-flex items-center px-4 py-2 border border-red-200 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
                          >
                            {cancellingId === b.id ? 'Cancelando...' : 'Cancelar reserva'}
                          </button>
                        </>
                      )}
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
