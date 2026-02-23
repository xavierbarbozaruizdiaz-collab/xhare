'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import PageLoading from '@/components/PageLoading';

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false });

export default function NewBuscoViajePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [originLat, setOriginLat] = useState<number | null>(null);
  const [originLng, setOriginLng] = useState<number | null>(null);
  const [destinationLat, setDestinationLat] = useState<number | null>(null);
  const [destinationLng, setDestinationLng] = useState<number | null>(null);
  const [requestedDate, setRequestedDate] = useState('');
  const [requestedTime, setRequestedTime] = useState('08:00');
  const [seats, setSeats] = useState(1);
  const [suggestedPrice, setSuggestedPrice] = useState<string>('');
  const [acceptOffersUntilHours, setAcceptOffersUntilHours] = useState(24);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/login?next=/offer/busco/new');
      setLoading(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !originLat || !originLng || !destinationLat || !destinationLng || !requestedDate) return;
    setSubmitting(true);
    const acceptUntil = new Date();
    acceptUntil.setHours(acceptUntil.getHours() + Math.max(1, Math.min(168, acceptOffersUntilHours)));
    const { data, error } = await supabase
      .from('passenger_ride_requests')
      .insert({
        user_id: user.id,
        origin_lat: originLat,
        origin_lng: originLng,
        origin_label: originLabel || null,
        destination_lat: destinationLat,
        destination_lng: destinationLng,
        destination_label: destinationLabel || null,
        requested_date: requestedDate,
        requested_time: requestedTime || null,
        seats: Math.max(1, Math.min(20, seats)),
        suggested_price_per_seat: suggestedPrice ? parseInt(suggestedPrice, 10) || null : null,
        status: 'open',
        accept_offers_until: acceptUntil.toISOString(),
      })
      .select('id')
      .single();
    setSubmitting(false);
    if (error) {
      alert(error.message || 'Error al crear la solicitud.');
      return;
    }
    router.push(`/offer/busco/${data.id}`);
  }

  async function geocode(field: 'origin' | 'destination', query: string) {
    if (!query.trim()) return;
    const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}&limit=1&countrycodes=py`);
    if (!res.ok) return;
    const data = await res.json();
    const first = data[0];
    if (first?.lat != null && first?.lon != null) {
      if (field === 'origin') {
        setOriginLat(first.lat);
        setOriginLng(first.lon);
        setOriginLabel(first.display_name || query);
      } else {
        setDestinationLat(first.lat);
        setDestinationLng(first.lon);
        setDestinationLabel(first.display_name || query);
      }
    }
  }

  if (loading) return <PageLoading />;

  const today = new Date().toISOString().slice(0, 10);
  const originPoint = originLat != null && originLng != null ? { lat: originLat, lng: originLng, label: originLabel || undefined } : null;
  const destinationPoint = destinationLat != null && destinationLng != null ? { lat: destinationLat, lng: destinationLng, label: destinationLabel || undefined } : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/offer/busco" className="text-green-600 font-semibold">← Busco viaje</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Nueva solicitud</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4">
        <p className="text-sm text-gray-600 mb-2">Elegí origen y destino en el mapa o escribí la dirección abajo.</p>
        <div className="h-80 border border-gray-200 rounded-xl overflow-hidden mb-6">
          <MapComponent
            pickup={originPoint}
            dropoff={destinationPoint}
            onPickupSelect={(point) => {
              setOriginLat(point.lat);
              setOriginLng(point.lng);
              setOriginLabel(point.label || '');
            }}
            onDropoffSelect={(point) => {
              setDestinationLat(point.lat);
              setDestinationLng(point.lng);
              setDestinationLabel(point.label || '');
            }}
          />
        </div>
      </div>
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-2 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Origen</label>
          <input
            type="text"
            value={originLabel}
            onChange={(e) => setOriginLabel(e.target.value)}
            onBlur={() => geocode('origin', originLabel)}
            placeholder="Dirección o lugar (o elegí en el mapa)"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Destino</label>
          <input
            type="text"
            value={destinationLabel}
            onChange={(e) => setDestinationLabel(e.target.value)}
            onBlur={() => geocode('destination', destinationLabel)}
            placeholder="Dirección o lugar (o elegí en el mapa)"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
            <input
              type="date"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              min={today}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hora aprox.</label>
            <input
              type="time"
              value={requestedTime}
              onChange={(e) => setRequestedTime(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Asientos</label>
          <input
            type="number"
            min={1}
            max={20}
            value={seats}
            onChange={(e) => setSeats(parseInt(e.target.value, 10) || 1)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Precio sugerido por asiento (PYG, opcional)</label>
          <input
            type="number"
            min={0}
            value={suggestedPrice}
            onChange={(e) => setSuggestedPrice(e.target.value)}
            placeholder="Ej. 25000"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Aceptar ofertas durante (horas)</label>
          <input
            type="number"
            min={1}
            max={168}
            value={acceptOffersUntilHours}
            onChange={(e) => setAcceptOffersUntilHours(parseInt(e.target.value, 10) || 24)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
          <p className="text-xs text-gray-500 mt-0.5">Después de este tiempo la solicitud dejará de recibir ofertas nuevas.</p>
        </div>
        <button
          type="submit"
          disabled={submitting || !originLat || !destinationLat || !requestedDate}
          className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? 'Creando...' : 'Publicar solicitud'}
        </button>
      </form>
    </div>
  );
}
