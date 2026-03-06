'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  role: string;
  created_at?: string;
};

type DriverAccount = {
  driver_id: string;
  account_status: string;
  debt_pyg: number;
  debt_limit_pyg: number;
  updated_at: string;
};

export default function AdminDriversPage() {
  const [pending, setPending] = useState<Profile[]>([]);
  const [approved, setApproved] = useState<Array<Profile & { account?: DriverAccount | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    loadPending();
    loadApproved();
  }, []);

  async function loadApproved() {
    const { data: drivers } = await supabase
      .from('profiles')
      .select('id, full_name, phone, address, city, role, created_at')
      .eq('role', 'driver')
      .order('full_name');
    const { data: accounts } = await supabase
      .from('driver_accounts')
      .select('driver_id, account_status, debt_pyg, debt_limit_pyg, updated_at');
    const accountByDriver: Record<string, DriverAccount> = {};
    (accounts ?? []).forEach((a: DriverAccount) => { accountByDriver[a.driver_id] = a; });
    setApproved((drivers ?? []).map((d) => ({ ...d, account: accountByDriver[d.id] ?? null })));
  }

  async function loadPending() {
    setLoading(true);
    let { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, address, city, role, created_at')
      .eq('role', 'driver_pending')
      .order('created_at', { ascending: false });
    if (error?.code === '42703' || error?.message?.includes('column')) {
      const res = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, created_at')
        .eq('role', 'driver_pending')
        .order('created_at', { ascending: false });
      data = (res.data ?? []).map((r) => ({ ...r, address: null, city: null }));
    }
    setPending(data ?? []);
    setLoading(false);
  }

  async function approve(id: string) {
    setActing(id);
    const { error } = await supabase
      .from('profiles')
      .update({ role: 'driver', driver_approved_at: new Date().toISOString() })
      .eq('id', id);
    setActing(null);
    if (error) alert(error.message);
    else loadPending();
  }

  async function reject(id: string) {
    setActing(id);
    const { error } = await supabase.from('profiles').update({ role: 'passenger' }).eq('id', id);
    setActing(null);
    if (error) alert(error.message);
    else loadPending();
  }

  async function setAccountStatus(driverId: string, status: 'active' | 'suspended') {
    setActing(driverId);
    const { data: existing } = await supabase.from('driver_accounts').select('driver_id').eq('driver_id', driverId).maybeSingle();
    if (existing) {
      await supabase.from('driver_accounts').update({ account_status: status, updated_at: new Date().toISOString() }).eq('driver_id', driverId);
    } else {
      await supabase.from('driver_accounts').insert({ driver_id: driverId, account_status: status, debt_pyg: 0, debt_limit_pyg: 50000 });
    }
    setActing(null);
    loadApproved();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Solicitudes de conductores</h1>
      <p className="text-gray-600 mb-6">
        Los pasajeros pueden usar la app sin aprobación. Quienes se registraron como conductores aparecen aquí hasta que los aprobés o rechacés.
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay solicitudes pendientes.
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((p) => (
            <li
              key={p.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{p.full_name || 'Sin nombre'}</p>
                <p className="text-sm text-gray-600">{p.phone || 'Sin teléfono'}</p>
                {(p.address || p.city) && (
                  <p className="text-sm text-gray-500 mt-1">
                    {[p.address, p.city].filter(Boolean).join(', ') || 'Sin domicilio'}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">ID: {p.id}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={acting !== null}
                  onClick={() => approve(p.id)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {acting === p.id ? 'Espera...' : 'Aprobar'}
                </button>
                <button
                  type="button"
                  disabled={acting !== null}
                  onClick={() => reject(p.id)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-4">Conductores aprobados</h2>
      <p className="text-gray-600 mb-4">
        Deuda y estado de cuenta. Podés suspender o reactivar. Para marcar pagos, usá <Link href="/admin/billing" className="text-green-600 hover:underline">Billing</Link>.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left p-3">Nombre</th>
              <th className="text-right p-3">Deuda (PYG)</th>
              <th className="text-right p-3">Límite</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-left p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {approved.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">No hay conductores aprobados.</td>
              </tr>
            ) : (
              approved.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="p-3">{d.full_name || d.id.slice(0, 8)}</td>
                  <td className="p-3 text-right">{(d.account?.debt_pyg ?? 0).toLocaleString('es-PY')}</td>
                  <td className="p-3 text-right">{(d.account?.debt_limit_pyg ?? 50000).toLocaleString('es-PY')}</td>
                  <td className="p-3">
                    <span className={d.account?.account_status === 'suspended' ? 'text-amber-700 font-medium' : 'text-green-700'}>
                      {d.account?.account_status === 'suspended' ? 'Suspendido' : 'Activo'}
                    </span>
                  </td>
                  <td className="p-3">
                    {d.account?.account_status === 'suspended' ? (
                      <button
                        type="button"
                        disabled={acting !== null}
                        onClick={() => setAccountStatus(d.id, 'active')}
                        className="text-green-600 hover:underline text-sm font-medium disabled:opacity-50"
                      >
                        {acting === d.id ? '...' : 'Reactivar'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={acting !== null}
                        onClick={() => setAccountStatus(d.id, 'suspended')}
                        className="text-amber-600 hover:underline text-sm font-medium disabled:opacity-50"
                      >
                        {acting === d.id ? '...' : 'Suspender'}
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
