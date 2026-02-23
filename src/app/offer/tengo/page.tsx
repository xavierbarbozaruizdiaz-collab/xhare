'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

function short(s: string | null | undefined, max = 35): string {
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

export default function TengoLugarListPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [myAvailability, setMyAvailability] = useState<any[]>([]);
  const [openAvailability, setOpenAvailability] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) {
      router.replace('/login?next=/offer/tengo');
      setLoading(false);
      return;
    }
    setUser(u);
    const { data: p } = await supabase.from('profiles').select('role').eq('id', u.id).single();
    setProfile(p);

    await supabase.rpc('expire_offer_flow_items');

    const isDriver = p?.role === 'driver';
    if (isDriver) {
      const { data: my } = await supabase
        .from('driver_ride_availability')
        .select('id, origin_label, destination_label, departure_time, available_seats, suggested_price_per_seat, status, created_at')
        .eq('driver_id', u.id)
        .order('created_at', { ascending: false });
      setMyAvailability(my || []);
    }

    const { data: open } = await supabase
      .from('driver_ride_availability')
      .select('id, driver_id, origin_label, destination_label, departure_time, available_seats, suggested_price_per_seat, created_at')
      .eq('status', 'open')
      .gte('departure_time', new Date().toISOString())
      .order('departure_time', { ascending: true })
      .limit(50);
    setOpenAvailability(open || []);

    setLoading(false);
  }

  const isDriver = profile?.role === 'driver';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer" className="text-green-600 font-semibold">← Oferta</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Tengo lugar</h1>
          <div className="flex items-center gap-2">
            {!isDriver && (
              <Link href="/offer/tengo/offers" className="px-3 py-2 text-green-600 font-medium rounded-xl border border-green-600 hover:bg-green-50">
                Mis ofertas
              </Link>
            )}
            {isDriver && (
              <Link href="/offer/tengo/new" className="px-4 py-2 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700">
                Publicar
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {isDriver && myAvailability.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Mis publicaciones</h2>
            <ul className="space-y-2">
              {myAvailability.map((r: any) => (
                <li key={r.id}>
                  <Link href={`/offer/tengo/${r.id}`} className="block p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300">
                    <p className="font-medium text-gray-900">{short(r.origin_label)} → {short(r.destination_label)}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{formatDateTime(r.departure_time)} · {r.available_seats} lugar{r.available_seats !== 1 ? 'es' : ''}</p>
                    <span className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded ${r.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{r.status === 'open' ? 'Abierta' : r.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Disponibilidad abierta</h2>
          {openAvailability.length === 0 ? (
            <p className="text-gray-500 text-sm p-4 bg-white rounded-xl border border-gray-200">No hay publicaciones abiertas.</p>
          ) : (
            <ul className="space-y-2">
              {openAvailability.filter((r: any) => !user || r.driver_id !== user.id).map((r: any) => (
                <li key={r.id}>
                  <Link href={`/offer/tengo/${r.id}`} className="block p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300">
                    <p className="font-medium text-gray-900">{short(r.origin_label)} → {short(r.destination_label)}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{formatDateTime(r.departure_time)} · {r.available_seats} lugar{r.available_seats !== 1 ? 'es' : ''}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
