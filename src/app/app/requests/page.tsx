'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

export default function RequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      router.push('/login');
      setLoading(false);
      return;
    }
    try {
      const accessToken = session.access_token;
      const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const response = await fetch('/api/requests', { headers });
      if (response.ok) {
        const data = await response.json();
        setRequests(Array.isArray(data) ? data : []);
      }
    } catch (_) {}
    setLoading(false);
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Mis Solicitudes</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/app')} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            Nueva Solicitud
          </button>
          <UserRoleBadge />
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/'))} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Cerrar Sesión
          </button>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        {requests.length === 0 ? (
          <p className="text-gray-500">No tenés solicitudes aún.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r: any) => (
              <li key={r.id} className="p-3 border rounded">
                {r.pickup_label || 'Origen'} → {r.dropoff_label || 'Destino'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
