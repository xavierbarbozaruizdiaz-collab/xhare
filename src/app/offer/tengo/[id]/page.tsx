'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

export default function TengoLugarDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [availability, setAvailability] = useState<any>(null);
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerSeats, setOfferSeats] = useState(1);
  const [offerMessage, setOfferMessage] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) {
      router.replace('/login?next=/offer/tengo/' + id);
      setLoading(false);
      return;
    }
    setUser(u);
    const { data: p } = await supabase.from('profiles').select('role').eq('id', u.id).single();
    setProfile(p);

    const { data: av, error: avErr } = await supabase
      .from('driver_ride_availability')
      .select('*')
      .eq('id', id)
      .single();
    if (avErr || !av) {
      setLoading(false);
      return;
    }
    setAvailability(av);

    const { data: off } = await supabase
      .from('passenger_offers')
      .select(`
        id, offered_price_per_seat, seats, message, status, created_at,
        passenger:profiles!passenger_offers_passenger_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
      `)
      .eq('availability_id', id)
      .order('created_at', { ascending: false });
    setOffers(off || []);

    setLoading(false);
  }

  const isOwner = availability && user && availability.driver_id === user.id;
  const isDriver = profile?.role === 'driver';

  async function sendOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !availability || !offerPrice.trim() || sendingOffer) return;
    const price = parseInt(offerPrice, 10);
    if (isNaN(price) || price < 0) return;
    const seats = Math.max(1, Math.min(availability.available_seats || 20, offerSeats));
    setSendingOffer(true);
    const { error } = await supabase.from('passenger_offers').insert({
      availability_id: availability.id,
      passenger_id: user.id,
      offered_price_per_seat: price,
      seats,
      message: offerMessage.trim() || null,
      status: 'pending',
    });
    setSendingOffer(false);
    if (error) {
      if (error.code === '23505') alert('Ya enviaste una oferta para esta publicación.');
      else alert(error.message || 'Error al enviar la oferta.');
      return;
    }
    setOfferPrice('');
    setOfferMessage('');
    load();
  }

  async function acceptOffer(offerId: string) {
    if (!user || !availability || availability.driver_id !== user.id) return;
    setAcceptingId(offerId);
    const { error: updateErr } = await supabase
      .from('passenger_offers')
      .update({ status: 'accepted' })
      .eq('id', offerId)
      .eq('availability_id', availability.id);
    if (updateErr) {
      setAcceptingId(null);
      return;
    }
    await supabase.from('passenger_offers').update({ status: 'rejected' }).eq('availability_id', availability.id).neq('id', offerId);
    await supabase.from('driver_ride_availability').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', availability.id);

    const { data: rideId, error: rpcErr } = await supabase.rpc('create_ride_from_accepted_passenger_offer', { p_offer_id: offerId });
    setAcceptingId(null);
    if (rpcErr) {
      alert(rpcErr.message || 'No se pudo crear el viaje.');
      load();
      return;
    }
    if (rideId) router.push('/rides/' + rideId);
    else load();
  }

  async function openChat(otherUserId: string) {
    const { data: convId } = await supabase.rpc('get_or_create_conversation', {
      p_other_user_id: otherUserId,
      p_context_type: 'driver_availability',
      p_context_id: id,
    });
    if (convId) router.push('/messages/' + convId);
  }

  if (loading) return <PageLoading />;
  if (!availability) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <p className="text-gray-600">Publicación no encontrada.</p>
        <Link href="/offer/tengo" className="ml-2 text-green-600 font-medium">Volver</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer/tengo" className="text-green-600 font-semibold">← Tengo lugar</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Publicación</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="font-medium text-gray-900">{availability.origin_label || 'Origen'} → {availability.destination_label || 'Destino'}</p>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateTime(availability.departure_time)} · {availability.available_seats} lugar{availability.available_seats !== 1 ? 'es' : ''}
            {availability.suggested_price_per_seat != null && ` · Sugerido: ${Number(availability.suggested_price_per_seat).toLocaleString('es-PY')} PYG/asiento`}
          </p>
          {availability.status !== 'open' && (
            <span className="inline-block mt-2 text-sm font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{availability.status}</span>
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
                  const p = o.passenger;
                  const ratingText = p?.rating_average != null && p?.rating_count != null && p.rating_count > 0
                    ? `★ ${Number(p.rating_average).toFixed(1)} · ${p.rating_count} viaje${Number(p.rating_count) !== 1 ? 's' : ''}`
                    : 'Nuevo';
                  const statusLabels: Record<string, string> = { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', expired: 'Expirada', cancelled: 'Cancelada' };
                  const statusClasses: Record<string, string> = {
                    pending: 'text-amber-700 bg-amber-50',
                    accepted: 'text-green-700 bg-green-50',
                    rejected: 'text-gray-500 bg-gray-100',
                    expired: 'text-gray-500 bg-gray-100',
                    cancelled: 'text-gray-500 bg-gray-100',
                  };
                  return (
                    <li key={o.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="w-12 h-12 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden text-gray-600 font-semibold">
                            {p?.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : (p?.full_name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900">{p?.full_name || 'Pasajero'}</p>
                            <p className="text-sm text-gray-600">{ratingText}</p>
                            <p className="text-green-600 font-semibold mt-1">{Number(o.offered_price_per_seat).toLocaleString('es-PY')} PYG/asiento · {o.seats} asiento{o.seats !== 1 ? 's' : ''}</p>
                            {o.message && <p className="text-sm text-gray-500 mt-1 italic">&quot;{o.message}&quot;</p>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusClasses[o.status] || 'text-gray-500 bg-gray-100'}`}>
                            {statusLabels[o.status] || o.status}
                          </span>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => openChat(p?.id)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Mensaje</button>
                            {o.status === 'pending' && availability.status === 'open' && (
                              <button
                                type="button"
                                onClick={() => acceptOffer(o.id)}
                                disabled={!!acceptingId}
                                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                              >
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

        {!isDriver && !isOwner && availability.status === 'open' && (
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
                <label className="block text-sm text-gray-600 mb-1">Asientos</label>
                <input
                  type="number"
                  min={1}
                  max={availability.available_seats || 20}
                  value={offerSeats}
                  onChange={(e) => setOfferSeats(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Mensaje (opcional)</label>
                <textarea
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  placeholder="Ej. Necesito 2 lugares..."
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
