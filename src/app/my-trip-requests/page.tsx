'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

function shortLabel(label: string | null | undefined, max = 50): string {
  if (!label) return '—';
  const t = String(label).trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

function requestStatusConfig(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800' },
    accepted: { label: 'Aceptada', className: 'bg-green-100 text-green-800' },
    expired: { label: 'Expirada', className: 'bg-gray-100 text-gray-600' },
    cancelled: { label: 'Cancelada', className: 'bg-red-100 text-red-800' },
  };
  return map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '—';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '—';
}

export default function MyTripRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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
      const today = new Date().toISOString().slice(0, 10);
      await supabase
        .from('trip_requests')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('user_id', session.user.id)
        .eq('status', 'pending')
        .lt('requested_date', today);

      const { data, error } = await supabase
        .from('trip_requests')
        .select('id, origin_label, destination_label, requested_date, requested_time, seats, status, ride_id, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRequests(data || []);
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      const { error } = await supabase
        .from('trip_requests')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .eq('status', 'pending');
      if (error) throw error;
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)));
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
          <Link href="/search" className="px-4 py-2 text-gray-700 hover:text-green-600 font-medium">
            Buscar viajes
          </Link>
          <Link href="/my-bookings" className="px-4 py-2 text-gray-700 hover:text-green-600 font-medium">
            Mis reservas
          </Link>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/'))} className="px-4 py-2 text-gray-700 hover:text-green-600">
            Cerrar sesión
          </button>
        </div>
      </header>
      <div className="container mx-auto p-4 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">Mis solicitudes de trayecto</h1>
        <p className="text-gray-600 mb-6">
          Son trayectos que guardaste cuando no había viajes. Los conductores pueden ver las pendientes y publicar un viaje; si lo hacen, podés reservar.
        </p>
        {requests.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500 mb-4">No tenés solicitudes guardadas.</p>
            <Link href="/search" className="inline-flex items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700">
              Buscar viajes
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {requests.map((r: any) => {
              const sc = requestStatusConfig(r.status);
              const canCancel = r.status === 'pending' && !cancellingId;
              return (
                <li key={r.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900" title={r.origin_label ?? ''}>
                        {shortLabel(r.origin_label)}
                      </p>
                      <p className="text-sm text-gray-500" title={r.destination_label ?? ''}>
                        → {shortLabel(r.destination_label)}
                      </p>
                    </div>
                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${sc.className}`}>
                      {sc.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    📅 {formatDate(r.requested_date)} · 🕐 {formatTime(r.requested_time)} · {Number(r.seats ?? 1)} asiento{(r.seats ?? 1) !== 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-wrap gap-3 items-center">
                    {r.status === 'accepted' && r.ride_id && (
                      <Link
                        href={`/rides/${r.ride_id}`}
                        className="inline-flex items-center px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700"
                      >
                        Ver viaje y reservar
                      </Link>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => handleCancel(r.id)}
                        disabled={cancellingId === r.id}
                        className="px-4 py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      >
                        {cancellingId === r.id ? 'Cancelando...' : 'Cancelar solicitud'}
                      </button>
                    )}
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
