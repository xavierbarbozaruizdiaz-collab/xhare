'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

function estimateDurationFromPolyline(points: Array<{ lat: number; lng: number }>): number {
  if (!points || points.length < 2) return 60;
  const R = 6371;
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    km += R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  return Math.max(15, Math.ceil((km / 50) * 60));
}

export default function EditRidePage() {
  const params = useParams();
  const router = useRouter();
  const rideId = params.id as string;
  const [ride, setRide] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState(60);

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u ?? null);
      if (!u) {
        router.replace(`/login?next=${encodeURIComponent(`/rides/${rideId}/edit`)}`);
        setLoading(false);
        return;
      }
      const { data: r, error: e } = await supabase
        .from('rides')
        .select('id, driver_id, departure_time, estimated_duration_minutes, base_route_polyline, origin_lat, origin_lng, destination_lat, destination_lng')
        .eq('id', rideId)
        .single();
      if (e || !r) {
        router.push('/my-rides');
        setLoading(false);
        return;
      }
      if (r.driver_id !== u.id) {
        router.push(`/rides/${rideId}`);
        setLoading(false);
        return;
      }
      setRide(r);
      const d = r.departure_time ? new Date(r.departure_time) : new Date();
      setDepartureDate(d.toISOString().slice(0, 10));
      setDepartureTime(d.toTimeString().slice(0, 5));
      const dur = r.estimated_duration_minutes ?? (Array.isArray(r.base_route_polyline) && r.base_route_polyline.length >= 2
        ? estimateDurationFromPolyline(r.base_route_polyline.map((p: any) => ({ lat: p.lat ?? p[1], lng: p.lng ?? p[0] })))
        : 60);
      setEstimatedDurationMinutes(Math.max(15, Math.min(1440, dur)));
      setLoading(false);
    })();
  }, [rideId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !ride) return;
    setError(null);
    setSubmitting(true);
    const departureDateTime = new Date(`${departureDate}T${departureTime}`);
    if (departureDateTime <= new Date()) {
      setError('La fecha y hora de salida deben ser futuras.');
      setSubmitting(false);
      return;
    }
    const durationMin = Math.max(15, Math.min(1440, estimatedDurationMinutes || 60));
    const newStart = departureDateTime.getTime();
    const newEnd = newStart + durationMin * 60 * 1000;
    const { data: existingRides } = await supabase
      .from('rides')
      .select('id, departure_time, estimated_duration_minutes')
      .eq('driver_id', user.id)
      .in('status', ['published', 'booked', 'en_route', 'draft']);
    for (const r of existingRides || []) {
      if (r.id === rideId) continue;
      const start = new Date(r.departure_time).getTime();
      const dur = (r.estimated_duration_minutes ?? 60) * 60 * 1000;
      const end = start + dur;
      if (newStart < end && newEnd > start) {
        setError('Ya tenés otro viaje en ese horario. No podés tener dos viajes que se solapen.');
        setSubmitting(false);
        return;
      }
    }
    const { error: err } = await supabase
      .from('rides')
      .update({
        departure_time: departureDateTime.toISOString(),
        estimated_duration_minutes: durationMin,
      })
      .eq('id', rideId)
      .eq('driver_id', user.id);
    setSubmitting(false);
    if (err) {
      const msg = (err as any)?.message ?? '';
      if (msg.includes('driver_ride_overlap') || msg.includes('solapen')) {
        setError('Ya tenés otro viaje en ese horario. No podés tener dos viajes que se solapen.');
        return;
      }
      setError(msg || 'No se pudo actualizar el viaje.');
      return;
    }
    router.push(`/rides/${rideId}`);
  }

  if (loading || !ride) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <header className="bg-white shadow-sm p-4 flex justify-between items-center mb-4 rounded-lg">
        <Link href={`/rides/${rideId}`} className="text-green-600 font-semibold">← Volver al viaje</Link>
        <Link href="/" className="text-2xl font-bold text-green-600">Xhare</Link>
      </header>
      <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6">
        <h1 className="text-xl font-bold mb-4">Editar horario del viaje</h1>
        <p className="text-sm text-gray-600 mb-4">Cambiá la fecha, hora o duración estimada. No puede solaparse con otro de tus viajes.</p>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de salida *</label>
            <input
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hora de salida *</label>
            <input
              type="time"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duración estimada (minutos)</label>
            <input
              type="number"
              min={15}
              max={1440}
              value={estimatedDurationMinutes}
              onChange={(e) => setEstimatedDurationMinutes(Math.max(15, Math.min(1440, parseInt(e.target.value) || 60)))}
              className="w-full px-3 py-2 border rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">Según ruta (origen, destino, paradas). Se usa para evitar solapamiento.</p>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      </div>
    </div>
  );
}
