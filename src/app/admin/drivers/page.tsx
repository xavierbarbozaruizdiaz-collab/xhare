'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  role: string;
  created_at?: string;
};

export default function AdminDriversPage() {
  const [pending, setPending] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    loadPending();
  }, []);

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
    </div>
  );
}
