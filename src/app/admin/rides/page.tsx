'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

type Ride = {
  id: string;
  origin_label: string | null;
  destination_label: string | null;
  departure_time: string | null;
  status: string;
  available_seats: number | null;
  total_seats: number | null;
  price_per_seat: number | null;
  created_at: string | null;
  driver_id: string | null;
  driver?: { full_name: string | null } | null;
};

export default function AdminRidesPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (rideId: string) => {
    if (!confirm('¿Eliminar este viaje? Se borrarán también las reservas asociadas.')) return;
    setDeletingId(rideId);
    const { error } = await supabase.from('rides').delete().eq('id', rideId);
    setDeletingId(null);
    if (error) {
      alert('No se pudo eliminar el viaje: ' + error.message);
      return;
    }
    setRides((prev) => prev.filter((r) => r.id !== rideId));
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('rides')
        .select(`
          id,
          origin_label,
          destination_label,
          departure_time,
          status,
          available_seats,
          total_seats,
          price_per_seat,
          created_at,
          driver_id,
          driver:profiles!rides_driver_id_fkey(full_name)
        `)
        .order('departure_time', { ascending: false })
        .limit(100);
      setRides(data ?? []);
    })().finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Viajes</h1>
      <p className="text-gray-600 mb-6">
        Todos los viajes publicados en la aplicación.
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : rides.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay viajes.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Origen → Destino</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Salida</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Chofer</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Asientos</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Estado</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700 w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rides.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <Link href={`/rides/${r.id}`} className="text-green-600 hover:underline">
                      {r.origin_label ?? '—'} → {r.destination_label ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {r.departure_time ? new Date(r.departure_time).toLocaleString('es-PY') : '—'}
                  </td>
                  <td className="px-4 py-3">{r.driver?.full_name ?? '—'}</td>
                  <td className="px-4 py-3">{r.available_seats ?? 0}/{r.total_seats ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100">{r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={deletingId === r.id}
                      className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Eliminar viaje"
                    >
                      {deletingId === r.id ? 'Eliminando…' : 'Eliminar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
