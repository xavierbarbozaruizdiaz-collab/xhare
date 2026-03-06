'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

type Charge = {
  id: string;
  ride_id: string;
  driver_id: string;
  amount_pyg: number;
  status: string;
  created_at: string;
};

type DriverName = { id: string; full_name: string | null };

export default function AdminBillingPage() {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all');
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('driver_charges')
      .select('id, ride_id, driver_id, amount_pyg, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    setCharges(rows ?? []);
    const driverIds = [...new Set((rows ?? []).map((r) => r.driver_id))];
    if (driverIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', driverIds);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: DriverName) => {
        map[p.id] = p.full_name ?? p.id.slice(0, 8);
      });
      setDriverNames(map);
    }
    setLoading(false);
  }

  async function markPaid(id: string) {
    setActing(id);
    const { error } = await supabase
      .from('driver_charges')
      .update({ status: 'paid' })
      .eq('id', id);
    setActing(null);
    if (error) alert(error.message);
    else await load();
  }

  const filtered = filter === 'all' ? charges : charges.filter((c) => c.status === filter);
  const pendingTotal = charges.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount_pyg, 0);

  function exportCsv() {
    const headers = ['id', 'ride_id', 'driver_id', 'driver_name', 'amount_pyg', 'status', 'created_at'];
    const lines = [headers.join(',')];
    filtered.forEach((c) => {
      lines.push([c.id, c.ride_id, c.driver_id, `"${(driverNames[c.driver_id] ?? '').replace(/"/g, '""')}"`, c.amount_pyg, c.status, c.created_at].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `driver_charges_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Billing</h1>
      <p className="text-gray-600 mb-4">
        Cargos por viaje completado. Marcar como pagado actualiza el estado y reduce la deuda del conductor.
      </p>
      <p className="text-sm text-amber-700 mb-4">
        Total pendiente (todos los cargos): <strong>{pendingTotal.toLocaleString('es-PY')} PYG</strong>
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'all' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          Todos
        </button>
        <button
          type="button"
          onClick={() => setFilter('pending')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'pending' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          Pendientes
        </button>
        <button
          type="button"
          onClick={() => setFilter('paid')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'paid' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          Pagados
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-200 text-gray-800 hover:bg-gray-300"
        >
          Exportar CSV
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left p-3">Fecha</th>
              <th className="text-left p-3">Conductor</th>
              <th className="text-left p-3">Viaje</th>
              <th className="text-right p-3">Monto (PYG)</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-left p-3">Acción</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  No hay cargos.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="p-3">{new Date(c.created_at).toLocaleString('es-PY')}</td>
                  <td className="p-3">{driverNames[c.driver_id] ?? c.driver_id.slice(0, 8)}</td>
                  <td className="p-3">
                    <Link href={`/rides/${c.ride_id}`} className="text-green-600 hover:underline">
                      {c.ride_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="p-3 text-right">{c.amount_pyg.toLocaleString('es-PY')}</td>
                  <td className="p-3">
                    <span className={c.status === 'paid' ? 'text-green-700' : 'text-amber-700'}>{c.status === 'paid' ? 'Pagado' : 'Pendiente'}</span>
                  </td>
                  <td className="p-3">
                    {c.status === 'pending' && (
                      <button
                        type="button"
                        disabled={acting !== null}
                        onClick={() => markPaid(c.id)}
                        className="text-green-600 hover:underline text-sm font-medium disabled:opacity-50"
                      >
                        {acting === c.id ? '...' : 'Marcar pagado'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
