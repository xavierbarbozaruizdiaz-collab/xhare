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

export default function AdminUsersPage() {
  const [list, setList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, created_at')
        .order('created_at', { ascending: false });
      setList(data ?? []);
    })().finally(() => setLoading(false));
  }, []);

  const byRole = (role: string) => list.filter((p) => p.role === role).length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Usuarios</h1>
      <p className="text-gray-600 mb-6">
        Todos los usuarios registrados y su rol.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">Pasajeros</p>
          <p className="text-xl font-bold">{byRole('passenger')}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">Conductores</p>
          <p className="text-xl font-bold">{byRole('driver')}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">Pendientes</p>
          <p className="text-xl font-bold">{byRole('driver_pending')}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">Admins</p>
          <p className="text-xl font-bold">{byRole('admin')}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Nombre</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Teléfono</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Rol</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Registro</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">{p.full_name || '—'}</td>
                  <td className="px-4 py-3">{p.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        p.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : p.role === 'driver'
                            ? 'bg-green-100 text-green-800'
                            : p.role === 'driver_pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {p.role}
                    </span>
                  </td>
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
