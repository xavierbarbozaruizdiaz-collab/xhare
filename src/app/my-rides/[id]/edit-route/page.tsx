'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

export default function EditRoutePage() {
  const params = useParams();
  const router = useRouter();
  const rideId = params.id as string;
  const [ride, setRide] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRide();
  }, [rideId]);

  async function loadRide() {
    try {
      const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .single();
      if (error) throw error;
      setRide(data);
    } catch (error) {
      router.push('/my-rides');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;
  if (!ride) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <header className="bg-white shadow-sm p-4 flex justify-between items-center mb-4">
        <Link href="/my-rides" className="text-2xl font-bold text-green-600">Xhare</Link>
      </header>
      <h1 className="text-2xl font-bold mb-4">Editar ruta del viaje</h1>
      <p className="text-gray-600">{ride.origin_label} → {ride.destination_label}</p>
      <Link href="/my-rides" className="mt-4 inline-block px-4 py-2 border rounded hover:bg-gray-100">Volver a mis viajes</Link>
    </div>
  );
}
