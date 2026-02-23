'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  created_at?: string;
};

export default function AdminPassengersPage() {
  const [list, setList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, created_at')
        .eq('role', 'passenger')
        .order('created_at', { ascending: false });
      setList(data ?? []);
    })().finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Pasajeros</h1>
      <p className="text-gray-600 mb-6">
        Los pasajeros pueden registrarse y usar la app sin aprobación.
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay pasajeros registrados.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Nombre</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Teléfono</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Registro</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">{p.full_name || '—'}</td>
                  <td className="px-4 py-3">{p.phone || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {p.created_at ? new Date(p.created_at).toLocaleDateString('es-PY') : '—'}
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
