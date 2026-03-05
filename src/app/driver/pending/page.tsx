'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Instructions = { email: string; message: string };

export default function DriverPendingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<Instructions | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      let { data } = await supabase
        .from('profiles')
        .select('role, driver_approved_at')
        .eq('id', user.id)
        .maybeSingle();
      if (data?.role === 'passenger') {
        await supabase.from('profiles').update({ role: 'driver_pending' }).eq('id', user.id);
        const res = await supabase.from('profiles').select('role, driver_approved_at').eq('id', user.id).maybeSingle();
        data = res.data ?? data;
      }
      setRole(data?.role ?? null);
      if (data?.role === 'driver' && data?.driver_approved_at) {
        router.push('/driver/setup');
        return;
      }
      if (data?.role !== 'driver_pending' && data?.role !== 'admin') {
        router.push('/');
        return;
      }
      const res = await fetch('/api/settings/driver-pending-instructions');
      if (res.ok) {
        const json = await res.json();
        setInstructions({ email: json.email ?? '', message: json.message ?? '' });
      } else {
        setInstructions({ email: '', message: 'Enviá el resto de los documentos por correo al email que te indiquemos.' });
      }
    })().finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <span className="text-3xl" aria-hidden>⏳</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Solicitud en revisión</h1>
        <p className="text-gray-600 mb-4">
          Tu registro como conductor está siendo revisado por un administrador. Cuando sea aprobado podrás publicar viajes.
        </p>
        {instructions && (instructions.message || instructions.email) && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg text-left">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{instructions.message}</p>
            {instructions.email && (
              <p className="text-sm mt-2">
                <strong>Correo para documentos:</strong>{' '}
                <a href={`mailto:${instructions.email}`} className="text-green-600 hover:underline">
                  {instructions.email}
                </a>
              </p>
            )}
          </div>
        )}
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700"
        >
          Volver al inicio
        </Link>
        <button
          type="button"
          onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/'; })}
          className="block w-full mt-3 text-sm text-gray-500 hover:text-gray-700"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
