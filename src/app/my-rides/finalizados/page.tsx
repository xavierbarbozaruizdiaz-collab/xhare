'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

function shortLabel(label: string | null | undefined, maxChars = 42): string {
  if (label == null || typeof label !== 'string') return '—';
  const t = String(label).trim();
  return t.length <= maxChars ? t : t.slice(0, maxChars) + '…';
}

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

export default function MyRidesFinalizadosPage() {
  const router = useRouter();
  const [rides, setRides] = useState<any[]>([]);
  const [reservedByRide, setReservedByRide] = useState<Record<string, number>>({});
  const [expectedAmountByRide, setExpectedAmountByRide] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
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
      const all = data || [];
      const now = new Date();
      const finished = all.filter((r: any) => {
        const status = r.status ?? '';
        const dep = r.departure_time ? new Date(r.departure_time) : null;
        if (status === 'completed' || status === 'cancelled') return true;
        if (dep && dep < now) return true;
        return false;
      });
      setRides(finished);

      const rideIds = finished.map((r: any) => r.id).filter(Boolean);
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
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <header className="bg-white border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40 shadow-sm">
        <div className="flex items-center justify-between gap-2 py-2 min-h-[48px]">
          <Link href="/my-rides" className="text-sm font-medium text-green-600 hover:text-green-700">← Mis viajes</Link>
          <h1 className="text-lg font-bold text-gray-900">Viajes finalizados</h1>
          <span className="w-16" />
        </div>
      </header>

      <div className="app-mobile-px py-6 max-w-3xl mx-auto">
        <p className="text-sm text-gray-500 mb-6">
          Viajes completados o cuya fecha ya pasó. Podés volver a agendar la misma ruta.
        </p>

        {rides.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <p className="text-gray-500">
              Aún no tenés viajes finalizados. Cuando completes un viaje o pase su fecha, aparecerán acá con la opción &quot;Volver a agendar&quot;.
            </p>
            <Link href="/my-rides" className="mt-4 inline-block btn-primary">
              Volver a Mis viajes
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {rides.map((r: any) => {
              const status = statusConfig(r.status);
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
                      {(expectedAmountByRide[r.id] ?? 0) > 0 && (
                        <span className="font-medium text-green-700">
                          A cobrar: {Number(expectedAmountByRide[r.id]).toLocaleString('es-PY')} PYG
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex gap-4 items-center">
                      <span className="text-sm font-medium text-green-600">Ver viaje →</span>
                      <Link
                        href={`/publish?from_ride_id=${encodeURIComponent(r.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-green-600 hover:text-green-700"
                      >
                        Volver a agendar
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
