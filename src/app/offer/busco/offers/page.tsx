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

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
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

export default function MyOffersBuscoPage() {
  const router = useRouter();
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login?next=/offer/busco/offers');
      setLoading(false);
      return;
    }
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (p?.role !== 'driver') {
      router.replace('/offer/busco');
      setLoading(false);
      return;
    }

    const { data: rows } = await supabase
      .from('driver_offers')
      .select(`
        id, proposed_price_per_seat, message, status, created_at, passenger_request_id,
        passenger_ride_requests(id, origin_label, destination_label, requested_date, requested_time, seats, status)
      `)
      .eq('driver_id', user.id)
      .order('created_at', { ascending: false });
    setOffers(rows || []);
    setLoading(false);
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer/busco" className="text-green-600 font-semibold">← Busco viaje</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Mis ofertas</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4">
        <p className="text-sm text-gray-600 mb-4">Ofertas que enviaste a solicitudes &quot;Busco viaje&quot;. Tocá una para ver la solicitud y escribir al pasajero.</p>
        {offers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500">
            <p>Aún no enviaste ofertas.</p>
            <Link href="/offer/busco" className="mt-2 inline-block text-green-600 font-medium hover:underline">Ver solicitudes abiertas</Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {offers.map((o: any) => {
              const req = o.passenger_ride_requests;
              const requestId = req?.id ?? o.passenger_request_id;
              const hasRequestData = req && (req.origin_label || req.destination_label);
              return (
                <li key={o.id}>
                  <Link
                    href={requestId ? `/offer/busco/${requestId}` : '/offer/busco'}
                    className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-green-300 transition"
                  >
                    <p className="font-medium text-gray-900">
                      {hasRequestData ? `${short(req.origin_label)} → ${short(req.destination_label)}` : 'Ver solicitud'}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {req?.requested_date ? formatDate(req.requested_date) : ''}
                      {req?.requested_time && ` · ${String(req.requested_time).slice(0, 5)}`}
                      {req?.seats != null && ` · ${req.seats} asiento${req.seats !== 1 ? 's' : ''}`}
                      {!req?.requested_date && !req?.requested_time && req?.seats == null && requestId && 'Tocá para ver detalle'}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                      <span className="text-green-600 font-semibold">{Number(o.proposed_price_per_seat).toLocaleString('es-PY')} PYG/asiento</span>
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
