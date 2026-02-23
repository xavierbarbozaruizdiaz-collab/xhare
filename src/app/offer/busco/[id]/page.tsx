'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function BuscoViajeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [request, setRequest] = useState<any>(null);
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) {
      router.replace('/login?next=/offer/busco/' + id);
      setLoading(false);
      return;
    }
    setUser(u);
    const { data: p } = await supabase.from('profiles').select('role').eq('id', u.id).single();
    setProfile(p);

    const { data: req, error: reqErr } = await supabase
      .from('passenger_ride_requests')
      .select('*')
      .eq('id', id)
      .single();
    if (reqErr || !req) {
      setLoading(false);
      return;
    }
    setRequest(req);

    const { data: off } = await supabase
      .from('driver_offers')
      .select(`
        id, proposed_price_per_seat, message, status, created_at,
        driver:profiles!driver_offers_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count, vehicle_model, vehicle_year, vehicle_seat_count)
      `)
      .eq('passenger_request_id', id)
      .order('created_at', { ascending: false });
    setOffers(off || []);

    setLoading(false);
  }

  const isOwner = request && user && request.user_id === user.id;
  const isDriver = profile?.role === 'driver';

  async function sendOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !request || !offerPrice.trim() || sendingOffer) return;
    const price = parseInt(offerPrice, 10);
    if (isNaN(price) || price < 0) return;
    setSendingOffer(true);
    const { error } = await supabase.from('driver_offers').insert({
      passenger_request_id: request.id,
      driver_id: user.id,
      proposed_price_per_seat: price,
      message: offerMessage.trim() || null,
      status: 'pending',
    });
    setSendingOffer(false);
    if (error) {
      if (error.code === '23505') alert('Ya enviaste una oferta para esta solicitud.');
      else alert(error.message || 'Error al enviar la oferta.');
      return;
    }
    setOfferPrice('');
    setOfferMessage('');
    load();
  }

  async function acceptOffer(offerId: string) {
    if (!user || !request || request.user_id !== user.id) return;
    setAcceptingId(offerId);
    const { error: updateErr } = await supabase
      .from('driver_offers')
      .update({ status: 'accepted' })
      .eq('id', offerId)
      .eq('passenger_request_id', request.id);
    if (updateErr) {
      setAcceptingId(null);
      return;
    }
    await supabase.from('driver_offers').update({ status: 'rejected' }).eq('passenger_request_id', request.id).neq('id', offerId);
    await supabase.from('passenger_ride_requests').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', request.id);

    const { data: rideId, error: rpcErr } = await supabase.rpc('create_ride_from_accepted_driver_offer', { p_offer_id: offerId });
    setAcceptingId(null);
    if (rpcErr) {
      alert(rpcErr.message || 'No se pudo crear el viaje. Revisá que el conductor no tenga otro viaje en ese horario.');
      load();
      return;
    }
    if (rideId) router.push('/rides/' + rideId);
    else load();
  }

  async function openChat(otherUserId: string) {
    const { data: convId } = await supabase.rpc('get_or_create_conversation', {
      p_other_user_id: otherUserId,
      p_context_type: 'passenger_request',
      p_context_id: id,
    });
    if (convId) router.push('/messages/' + convId);
  }

  if (loading) return <PageLoading />;
  if (!request) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <p className="text-gray-600">Solicitud no encontrada.</p>
        <Link href="/offer/busco" className="ml-2 text-green-600 font-medium">Volver</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer/busco" className="text-green-600 font-semibold">← Busco viaje</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Solicitud</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="font-medium text-gray-900">{request.origin_label || 'Origen'} → {request.destination_label || 'Destino'}</p>
          <p className="text-sm text-gray-500 mt-1">
            {formatDate(request.requested_date)}
            {request.requested_time && ` · ${String(request.requested_time).slice(0, 5)}`}
            {' · '}{request.seats} asiento{request.seats !== 1 ? 's' : ''}
            {request.suggested_price_per_seat != null && ` · Sugerido: ${Number(request.suggested_price_per_seat).toLocaleString('es-PY')} PYG/asiento`}
          </p>
          {request.status !== 'open' && (
            <span className="inline-block mt-2 text-sm font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{request.status}</span>
          )}
        </div>

        {isOwner && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Ofertas recibidas</h2>
            {offers.length === 0 ? (
              <p className="text-gray-500 text-sm">Aún no hay ofertas.</p>
            ) : (
              <ul className="space-y-3">
                {offers.map((o: any) => {
                  const d = o.driver;
                  const vehiclePart = [d?.vehicle_model, d?.vehicle_year].filter(Boolean).join(' ') || 'Vehículo no especificado';
                  const seatsPart = d?.vehicle_seat_count != null ? `${d.vehicle_seat_count} asientos` : null;
                  const vehicleLine = seatsPart ? `${vehiclePart} · ${seatsPart}` : vehiclePart;
                  const ratingText = d?.rating_average != null && d?.rating_count != null && d.rating_count > 0
                    ? `★ ${Number(d.rating_average).toFixed(1)} · ${d.rating_count} viaje${Number(d.rating_count) !== 1 ? 's' : ''}`
                    : 'Nuevo';
                  return (
                    <li key={o.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="w-12 h-12 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden text-gray-600 font-semibold">
                            {d?.avatar_url ? <img src={d.avatar_url} alt="" className="w-full h-full object-cover" /> : (d?.full_name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900">{d?.full_name || 'Conductor'}</p>
                            <p className="text-sm text-gray-600">{ratingText}</p>
                            <p className="text-sm text-gray-500 mt-0.5">{vehicleLine}</p>
                            <p className="text-green-600 font-semibold mt-1">{Number(o.proposed_price_per_seat).toLocaleString('es-PY')} PYG/asiento</p>
                            {o.message && <p className="text-sm text-gray-500 mt-1 italic">&quot;{o.message}&quot;</p>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          {o.status === 'pending' && <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Pendiente</span>}
                          {o.status === 'accepted' && <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">Aceptada</span>}
                          {o.status === 'rejected' && <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Rechazada</span>}
                          {o.status === 'expired' && <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Expirada</span>}
                          <div className="flex gap-2">
                            <button type="button" onClick={() => openChat(d?.id)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Mensaje</button>
                            {o.status === 'pending' && request.status === 'open' && (
                              <button type="button" onClick={() => acceptOffer(o.id)} disabled={!!acceptingId} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                                {acceptingId === o.id ? '...' : 'Aceptar'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {isDriver && !isOwner && request.status === 'open' && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Enviar oferta</h2>
            <form onSubmit={sendOffer} className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Precio por asiento (PYG)</label>
                <input
                  type="number"
                  min={0}
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  placeholder="25000"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Mensaje (opcional)</label>
                <textarea
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  placeholder="Ej. Salgo a las 8, tengo 4 lugares..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                />
              </div>
              <button type="submit" disabled={sendingOffer} className="w-full py-2.5 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 disabled:opacity-50">
                {sendingOffer ? 'Enviando...' : 'Enviar oferta'}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
