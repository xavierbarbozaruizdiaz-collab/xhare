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

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function BuscoViajeListPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [openRequests, setOpenRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) {
      router.replace('/login?next=/offer/busco');
      setLoading(false);
      return;
    }
    setUser(u);
    const { data: p } = await supabase.from('profiles').select('role').eq('id', u.id).single();
    setProfile(p);

    await supabase.rpc('expire_offer_flow_items');

    const { data: my } = await supabase
      .from('passenger_ride_requests')
      .select('id, origin_label, destination_label, requested_date, requested_time, seats, suggested_price_per_seat, status, created_at')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false });
    setMyRequests(my || []);

    const { data: open } = await supabase
      .from('passenger_ride_requests')
      .select('id, user_id, origin_label, destination_label, requested_date, requested_time, seats, suggested_price_per_seat, created_at')
      .eq('status', 'open')
      .order('requested_date', { ascending: true })
      .limit(50);
    setOpenRequests(open || []);

    setLoading(false);
  }

  if (loading) return <PageLoading />;

  const isDriver = profile?.role === 'driver';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer" className="text-green-600 font-semibold">← Oferta</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Busco viaje</h1>
          <div className="flex items-center gap-2">
            {isDriver && (
              <Link href="/offer/busco/offers" className="px-3 py-2 text-green-600 font-medium rounded-xl border border-green-600 hover:bg-green-50">
                Mis ofertas
              </Link>
            )}
            {!isDriver && (
              <Link
                href="/offer/busco/new"
                className="px-4 py-2 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700"
              >
                Crear solicitud
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {!isDriver && myRequests.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Mis solicitudes</h2>
            <ul className="space-y-2">
              {myRequests.map((r: any) => (
                <li key={r.id}>
                  <Link
                    href={`/offer/busco/${r.id}`}
                    className="block p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300"
                  >
                    <p className="font-medium text-gray-900">{short(r.origin_label)} → {short(r.destination_label)}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatDate(r.requested_date)}
                      {r.requested_time && ` · ${String(r.requested_time).slice(0, 5)}`}
                      {' · '}{r.seats} asiento{r.seats !== 1 ? 's' : ''}
                      {r.suggested_price_per_seat != null && ` · ${Number(r.suggested_price_per_seat).toLocaleString('es-PY')} PYG/asiento`}
                    </p>
                    <span className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded ${r.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {r.status === 'open' ? 'Abierta' : r.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {isDriver ? 'Solicitudes para ofertar' : 'Otras solicitudes abiertas'}
          </h2>
          {openRequests.length === 0 ? (
            <p className="text-gray-500 text-sm p-4 bg-white rounded-xl border border-gray-200">No hay solicitudes abiertas.</p>
          ) : (
            <ul className="space-y-2">
              {openRequests.filter((r: any) => !user || r.user_id !== user.id).map((r: any) => (
                <li key={r.id}>
                  <Link
                    href={`/offer/busco/${r.id}`}
                    className="block p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300"
                  >
                    <p className="font-medium text-gray-900">{short(r.origin_label)} → {short(r.destination_label)}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatDate(r.requested_date)}
                      {r.requested_time && ` · ${String(r.requested_time).slice(0, 5)}`}
                      {' · '}{r.seats} asiento{r.seats !== 1 ? 's' : ''}
                      {r.suggested_price_per_seat != null && ` · ${Number(r.suggested_price_per_seat).toLocaleString('es-PY')} PYG/asiento`}
                    </p>
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
