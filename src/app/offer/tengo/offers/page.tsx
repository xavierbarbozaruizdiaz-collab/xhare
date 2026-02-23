'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

function short(s: string | null | undefined, max = 40): string {
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(s: string): string {
  const map: Record<string, string> = { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', expired: 'Expirada', cancelled: 'Cancelada' };
  return map[s] || s;
}

function statusClass(s: string): string {
  const map: Record<string, string> = {
    pending: 'text-amber-700 bg-amber-50',
    accepted: 'text-green-700 bg-green-50',
    rejected: 'text-gray-600 bg-gray-100',
    expired: 'text-gray-500 bg-gray-100',
    cancelled: 'text-gray-500 bg-gray-100',
  };
  return map[s] || 'text-gray-600 bg-gray-100';
}

export default function MyOffersTengoPage() {
  const router = useRouter();
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login?next=/offer/tengo/offers');
      setLoading(false);
      return;
    }

    const { data: rows } = await supabase
      .from('passenger_offers')
      .select(`
        id, offered_price_per_seat, seats, message, status, created_at, availability_id,
        driver_ride_availability(id, origin_label, destination_label, departure_time, available_seats, suggested_price_per_seat, status)
      `)
      .eq('passenger_id', user.id)
      .order('created_at', { ascending: false });
    setOffers(rows || []);
    setLoading(false);
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer/tengo" className="text-green-600 font-semibold">← Tengo lugar</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Mis ofertas</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4">
        <p className="text-sm text-gray-600 mb-4">Ofertas que enviaste a publicaciones &quot;Tengo lugar&quot;. Tocá una para ver la publicación y escribir al conductor.</p>
        {offers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500">
            <p>Aún no enviaste ofertas.</p>
            <Link href="/offer/tengo" className="mt-2 inline-block text-green-600 font-medium hover:underline">Ver publicaciones abiertas</Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {offers.map((o: any) => {
              const avail = o.driver_ride_availability;
              const availabilityId = avail?.id ?? o.availability_id;
              return (
                <li key={o.id}>
                  <Link
                    href={availabilityId ? `/offer/tengo/${availabilityId}` : '/offer/tengo'}
                    className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-green-300 transition"
                  >
                    <p className="font-medium text-gray-900">{avail ? short(avail.origin_label) : '—'} → {avail ? short(avail.destination_label) : '—'}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {avail ? formatDateTime(avail.departure_time) : '—'}
                      {avail?.available_seats != null && ` · ${avail.available_seats} asiento${avail.available_seats !== 1 ? 's' : ''} disponibles`}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                      <span className="text-green-600 font-semibold">{Number(o.offered_price_per_seat).toLocaleString('es-PY')} PYG/asiento</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusClass(o.status)}`}>{statusLabel(o.status)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
