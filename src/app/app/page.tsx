'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false });

export default function PassengerApp() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pickup, setPickup] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number; label?: string } | null>(null);

  useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) {
        router.push('/login');
        return;
      }
      setUser(user);
    } catch (error) {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Solicitar Viaje</h1>
        <div className="flex items-center gap-4">
          <UserRoleBadge />
          <button
            onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/'; })}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 mb-4">Seleccioná origen y destino en el mapa, luego creá tu solicitud.</p>
        <div className="h-96 border rounded">
          <MapComponent
            pickup={pickup}
            dropoff={dropoff}
            onPickupSelect={setPickup}
            onDropoffSelect={setDropoff}
          />
        </div>
        <div className="mt-4">
          <a href="/app/requests" className="text-green-600 hover:underline">Ver mis solicitudes →</a>
        </div>
      </div>
    </div>
  );
}
