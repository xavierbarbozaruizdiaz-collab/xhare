'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function OfferHubPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/login?next=/offer');
    });
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-green-600 font-semibold">← Inicio</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Viajes a oferta</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-600 mb-6">
          Negociá el precio con conductores o pasajeros. Publicá lo que buscás o lo que ofrecés y recibí ofertas.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/offer/busco"
            className="block p-6 bg-white rounded-2xl border-2 border-gray-200 hover:border-green-400 hover:shadow-lg transition text-center"
          >
            <span className="text-4xl mb-3 block">🔍</span>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Busco viaje</h2>
            <p className="text-sm text-gray-600">Publicá tu trayecto y recibí ofertas de conductores.</p>
          </Link>
          <Link
            href="/offer/tengo"
            className="block p-6 bg-white rounded-2xl border-2 border-gray-200 hover:border-green-400 hover:shadow-lg transition text-center"
          >
            <span className="text-4xl mb-3 block">🚗</span>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Tengo lugar</h2>
            <p className="text-sm text-gray-600">Publicá que tenés lugar y recibí ofertas de pasajeros.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
