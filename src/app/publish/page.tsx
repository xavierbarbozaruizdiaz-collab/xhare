'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
});

/** Estima duración en minutos desde polyline (haversine, ~50 km/h) cuando la API no devuelve duración */
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

/** Formatea el error de Supabase para mostrarlo al usuario (mensaje, código 400, detalles). */
function formatSupabaseError(error: any): string {
  if (error == null) return 'Error desconocido';
  const msg = error?.message ?? error?.error_description ?? '';
  const code = error?.code ?? '';
  const details = error?.details ?? '';
  const hint = error?.hint ?? '';
  const parts = [msg];
  if (code) parts.push(`Código: ${code}`);
  if (details) parts.push(typeof details === 'string' ? details : JSON.stringify(details));
  if (hint) parts.push(`Hint: ${hint}`);
  return parts.join('\n');
}

export default function PublishRidePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripRequestIdParam = searchParams.get('trip_request_id');
  const tripRequestIds = tripRequestIdParam ? tripRequestIdParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const tripRequestId = tripRequestIds[0] ?? null;
  const fromRideId = searchParams.get('from_ride_id');
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [origin, setOrigin] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<any[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<any[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [availableSeats, setAvailableSeats] = useState(6);
  const [description, setDescription] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [departureFlexibility, setDepartureFlexibility] = useState<'strict_5' | 'flexible_30'>('strict_5');
  const [waypoints, setWaypoints] = useState<Array<{ lat: number; lng: number; label?: string }>>([]);
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState<number | null>(null);
  const [publishedRideId, setPublishedRideId] = useState<string | null>(null);
  const [publishRouteWarning, setPublishRouteWarning] = useState<string | null>(null);
  /** Todas las solicitudes cargadas cuando se llega desde trip_request_id(s) (paradas de pasajeros en el mapa) */
  const [tripRequestsData, setTripRequestsData] = useState<Array<{
    origin_lat: number; origin_lng: number; origin_label: string | null;
    destination_lat: number; destination_lng: number; destination_label: string | null;
  }>>([]);

  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    if (tripRequestIds.length === 0 || !user?.id) return;
    (async () => {
      const { data: rows } = await supabase
        .from('trip_requests')
        .select('origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, requested_date, requested_time')
        .in('id', tripRequestIds)
        .eq('status', 'pending');
      if (!rows?.length) return;
      const first = rows[0];
      setOrigin({ lat: first.origin_lat, lng: first.origin_lng, label: first.origin_label ?? undefined });
      setOriginInput(first.origin_label ?? '');
      setDestination({ lat: first.destination_lat, lng: first.destination_lng, label: first.destination_label ?? undefined });
      setDestinationInput(first.destination_label ?? '');
      if (first.requested_date) {
        setDepartureDate(first.requested_date);
        const t = first.requested_time;
        setDepartureTime(typeof t === 'string' && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5) : '08:00');
      }
      setTripRequestsData(rows.map((r) => ({
        origin_lat: r.origin_lat,
        origin_lng: r.origin_lng,
        origin_label: r.origin_label,
        destination_lat: r.destination_lat,
        destination_lng: r.destination_lng,
        destination_label: r.destination_label,
      })));
    })();
  }, [tripRequestIds.join(','), user?.id]);

  // Pre-rellenar desde un viaje finalizado (Volver a agendar)
  useEffect(() => {
    if (!fromRideId || !user?.id) return;
    (async () => {
      const { data: ride, error } = await supabase
        .from('rides')
        .select('origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, departure_time')
        .eq('id', fromRideId)
        .eq('driver_id', user.id)
        .maybeSingle();
      if (error || !ride) return;
      if (ride.origin_lat != null && ride.origin_lng != null) {
        setOrigin({ lat: Number(ride.origin_lat), lng: Number(ride.origin_lng), label: ride.origin_label ?? undefined });
        setOriginInput(ride.origin_label ?? '');
      }
      if (ride.destination_lat != null && ride.destination_lng != null) {
        setDestination({ lat: Number(ride.destination_lat), lng: Number(ride.destination_lng), label: ride.destination_label ?? undefined });
        setDestinationInput(ride.destination_label ?? '');
      }
      if (ride.departure_time) {
        const d = new Date(ride.departure_time);
        setDepartureDate(d.toISOString().slice(0, 10));
        const h = d.getHours();
        const m = d.getMinutes();
        setDepartureTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    })();
  }, [fromRideId, user?.id]);

  // Refrescar perfil al volver a la pestaña (p. ej. después de actualizar vehículo en /driver/setup)
  useEffect(() => {
    if (!user?.id || !userProfile) return;
    const refetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('vehicle_seat_count, vehicle_model, vehicle_year, vehicle_seat_layout')
        .eq('id', user.id)
        .maybeSingle();
      if (data && userProfile) {
        const seatCount = data.vehicle_seat_count != null ? Number(data.vehicle_seat_count) : userProfile.vehicle_seat_count;
        setUserProfile((prev: any) => (prev ? { ...prev, ...data, vehicle_seat_count: seatCount ?? prev.vehicle_seat_count } : prev));
        if (seatCount != null) setAvailableSeats(Math.max(6, seatCount));
      }
    };
    const onFocus = () => refetchProfile();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.id, userProfile]);

  useEffect(() => {
    if (origin?.label) setOriginInput(origin.label);
  }, [origin]);

  useEffect(() => {
    if (destination?.label) setDestinationInput(destination.label);
  }, [destination]);

  async function checkUser() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) {
        router.push('/login');
        return;
      }
      setUser(user);
      let profile: any = null;
      let profileError: any = null;
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('role, full_name, vehicle_seat_count, vehicle_seat_layout, vehicle_model, vehicle_year, driver_approved_at')
        .eq('id', user.id)
        .maybeSingle();
      profile = profileData;
      profileError = profileErr;
      if (profileError?.code === 'PGRST301' || profileError?.code === '42703' || (profileError?.message && profileError.message.includes('column'))) {
        const { data: basic } = await supabase.from('profiles').select('role, full_name, driver_approved_at').eq('id', user.id).maybeSingle();
        profile = basic;
        profileError = null;
      }
      if (profileError || !profile) {
        router.push('/login');
        return;
      }
      if (profile?.role === 'driver_pending' || (profile?.role === 'driver' && !profile?.driver_approved_at)) {
        router.push('/driver/pending');
        return;
      }
      if (profile?.role !== 'driver') {
        alert('Solo los choferes pueden publicar viajes.');
        router.push('/');
        return;
      }
      if (profile?.vehicle_seat_count == null) {
        router.push('/driver/setup');
        return;
      }
      if (!profile?.vehicle_model?.trim() || !profile?.vehicle_year) {
        router.push('/driver/setup');
        return;
      }
      const seatCount = profile?.vehicle_seat_count != null ? Number(profile.vehicle_seat_count) : null;
      setUserProfile(seatCount != null ? { ...profile, vehicle_seat_count: seatCount } : profile);
      setAvailableSeats(Math.max(6, seatCount ?? 6));
      setVehicleModel(profile.vehicle_model ?? '');
      setVehicleYear(profile.vehicle_year != null ? String(profile.vehicle_year) : '');
      setLoading(false);
    } catch (error) {
      router.push('/login');
      setLoading(false);
    }
  }

  async function searchAddresses(query: string, type: 'origin' | 'destination') {
    if (query.length < 3) {
      if (type === 'origin') {
        setOriginSuggestions([]);
        setShowOriginSuggestions(false);
      } else {
        setDestinationSuggestions([]);
        setShowDestinationSuggestions(false);
      }
      return;
    }
    try {
      const response = await fetch(
        `/api/geocode/search?q=${encodeURIComponent(query)}&limit=5&countrycodes=py`
      );
      if (!response.ok) return;
      const data = await response.json();
      if (type === 'origin') {
        setOriginSuggestions(data);
        setShowOriginSuggestions(true);
      } else {
        setDestinationSuggestions(data);
        setShowDestinationSuggestions(true);
      }
    } catch (error) {
      console.error('Error searching addresses:', error);
    }
  }

  async function addWaypointFromMap(lat: number, lng: number, label?: string) {
    let resolvedLabel = label;
    if (!resolvedLabel) {
      try {
        const response = await fetch(
          `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
        );
        if (response.ok) {
          const data = await response.json();
          resolvedLabel = data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        } else {
          resolvedLabel = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
      } catch {
        resolvedLabel = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }
    }
    setWaypoints([...waypoints, { lat, lng, label: resolvedLabel }]);
    setAddingWaypoint(false);
  }

  function selectSuggestion(suggestion: any, type: 'origin' | 'destination') {
    const point = {
      lat: parseFloat(suggestion.lat),
      lng: parseFloat(suggestion.lon),
      label: suggestion.display_name,
    };
    if (type === 'origin') {
      setOrigin(point);
      setOriginInput(point.label || '');
      setShowOriginSuggestions(false);
    } else {
      setDestination(point);
      setDestinationInput(point.label || '');
      setShowDestinationSuggestions(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
      alert('Por favor selecciona el origen y destino en el mapa o elige una sugerencia del autocompletado');
      return;
    }
    if (!departureDate || !departureTime) {
      alert('Por favor completa todos los campos obligatorios');
      return;
    }
    setSubmitting(true);
    try {
      const departureDateTime = new Date(`${departureDate}T${departureTime}`);
      if (departureDateTime <= new Date()) {
        alert('La fecha y hora de salida deben ser futuras');
        setSubmitting(false);
        return;
      }
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!currentProfile || currentProfile.role !== 'driver') {
        alert('Solo los choferes pueden publicar viajes');
        setSubmitting(false);
        return;
      }
      const waypointsOnly = waypoints.map(w => ({ lat: w.lat, lng: w.lng }));
      let baseRoute: any = null;
      let durationMin = 60;
      try {
        const res = await fetch('/api/route/polyline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: { lat: origin.lat, lng: origin.lng },
            destination: { lat: destination.lat, lng: destination.lng },
            waypoints: waypointsOnly.length > 0 ? waypointsOnly : undefined,
          }),
        });
        const data = await res.json();
        if (Array.isArray(data.polyline) && data.polyline.length >= 2) baseRoute = data.polyline;
        if (data.durationMinutes != null) durationMin = Math.max(15, Math.min(1440, Number(data.durationMinutes)));
        else if (baseRoute?.length >= 2) durationMin = estimateDurationFromPolyline(baseRoute);
      } catch (_) {
        durationMin = estimateDurationFromPolyline([origin, ...waypointsOnly, destination].filter((p: any) => p?.lat != null && p?.lng != null));
      }
      const newStart = departureDateTime.getTime();
      const newEnd = newStart + durationMin * 60 * 1000;
      const { data: existingRides } = await supabase
        .from('rides')
        .select('id, departure_time, estimated_duration_minutes')
        .eq('driver_id', user.id)
        .in('status', ['published', 'booked', 'en_route', 'draft']);
      for (const r of existingRides || []) {
        const start = new Date(r.departure_time).getTime();
        const dur = (r.estimated_duration_minutes ?? 60) * 60 * 1000;
        const end = start + dur;
        if (newStart < end && newEnd > start) {
          alert('Ya tenés un viaje en ese horario. Un chofer no puede tener dos viajes con la misma salida o que se solapen en tiempo. Revisá Mis viajes.');
          setSubmitting(false);
          return;
        }
      }

      const ridePayload: Record<string, unknown> = {
        driver_id: user.id,
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        origin_label: origin.label,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        destination_label: destination.label,
        departure_time: departureDateTime.toISOString(),
        estimated_duration_minutes: durationMin,
        price_per_seat: 0,
        total_seats: userProfile?.vehicle_seat_count ?? availableSeats,
        available_seats: userProfile?.vehicle_seat_count ?? availableSeats,
        capacity: userProfile?.vehicle_seat_count ?? availableSeats,
        description: description || null,
        vehicle_info: { model: userProfile?.vehicle_model ?? vehicleModel, year: userProfile?.vehicle_year ?? (vehicleYear ? parseInt(vehicleYear, 10) : null) },
        seat_layout: userProfile?.vehicle_seat_layout ?? { rows: [userProfile?.vehicle_seat_count ?? availableSeats] },
        flexible_departure: departureFlexibility === 'flexible_30',
        departure_flexibility: departureFlexibility,
        status: 'published',
        mode: 'free',
      };

      // Insert sin base_route_polyline ni max_deviation_km para no depender de caché PostgREST ni esquema
      let { data, error } = await supabase
        .from('rides')
        .insert(ridePayload)
        .select()
        .single();

      if (error) {
        const msg = (error as any)?.message ?? '';
        if (msg.includes('driver_ride_overlap') || msg.includes('solapen')) {
          alert('Ya tenés un viaje en ese horario. Un chofer no puede tener dos viajes que se solapen. Revisá Mis viajes.');
          setSubmitting(false);
          return;
        }
        const { departure_flexibility: _, ...payloadSinFlex } = ridePayload as Record<string, unknown> & { departure_flexibility?: string };
        const { data: data2, error: error2 } = await supabase
          .from('rides')
          .insert(payloadSinFlex)
          .select()
          .single();
        if (error2) throw error2;
        data = data2;
        error = null;
      }

      // Vincular solicitudes al viaje en cuanto tengamos el id (antes de ride_stops), para que las paradas de pasajeros queden guardadas aunque falle algo después
      if (tripRequestIds.length > 0 && data?.id) {
        const { error: tripErr } = await supabase
          .from('trip_requests')
          .update({ ride_id: data.id, status: 'accepted', updated_at: new Date().toISOString() })
          .in('id', tripRequestIds);
        if (tripErr) {
          console.error('Error al vincular solicitudes al viaje:', tripErr);
          alert('El viaje se creó pero no se pudieron vincular las solicitudes de pasajeros. Podés editar el viaje o contactar soporte.');
        }
      }

      // Opcional: guardar ruta y desvío; si falla (ej. 400 por columnas inexistentes) no bloqueamos el éxito
      let updateRouteWarning: string | null = null;
      if (data && baseRoute != null) {
        const { error: updateErr } = await supabase
          .from('rides')
          .update({ base_route_polyline: baseRoute, max_deviation_km: 1.0 })
          .eq('id', data.id);
        if (updateErr) {
          console.warn('Update base_route_polyline failed (ride was still created):', updateErr);
          updateRouteWarning = formatSupabaseError(updateErr);
        }
      }

      if (data) {
        const stopsBase = [
          { ride_id: data.id, stop_order: 0, lat: origin.lat, lng: origin.lng, label: origin.label || null },
          ...waypoints.map((wp, i) => ({
            ride_id: data.id,
            stop_order: i + 1,
            lat: wp.lat,
            lng: wp.lng,
            label: wp.label || null,
          })),
          { ride_id: data.id, stop_order: waypoints.length + 1, lat: destination.lat, lng: destination.lng, label: destination.label || null },
        ];
        const stopsWithBase = stopsBase.map((s, i) => ({
          ...s,
          is_base_stop: i === 0 || i === stopsBase.length - 1,
        }));
        let stopsError: any = null;
        const { error: err1 } = await supabase.from('ride_stops').insert(stopsWithBase);
        if (err1 && String(err1.message).includes('is_base_stop')) {
          const { error: err2 } = await supabase.from('ride_stops').insert(stopsBase);
          stopsError = err2;
        } else {
          stopsError = err1;
        }
        if (stopsError) throw stopsError;
      }
      if (error) throw error;

      setPublishRouteWarning(updateRouteWarning ?? null);
      setPublishedRideId(data!.id);
    } catch (error: any) {
      const msgStr = formatSupabaseError(error);
      if (msgStr.includes('base_route_polyline') || msgStr.includes('schema cache') || (error?.code === 'PGRST301')) {
        const supabaseUrl = typeof process.env.NEXT_PUBLIC_SUPABASE_URL === 'string'
          ? process.env.NEXT_PUBLIC_SUPABASE_URL
          : '(revisá .env.local)';
        alert(
          'Falta actualizar la base de datos: la columna base_route_polyline no existe en la tabla rides.\n\n' +
          'Tu app está conectada a: ' + supabaseUrl + '\n\n' +
          '1) Entrá a ese proyecto en app.supabase.com → SQL Editor y ejecutá el contenido de 008_ensure_base_route_polyline.sql\n' +
          '2) Si ya lo hiciste en otro proyecto, ejecutá el mismo SQL en el proyecto de la URL de arriba.\n' +
          '3) Esperá 1–2 minutos y recargá la página (Ctrl+Shift+R).'
        );
      } else {
        alert(`Error al publicar el viaje:\n\n${msgStr}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50">
      {publishedRideId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Viaje publicado</h2>
            <p className="text-gray-600 mb-6">
              Tu viaje se publicó correctamente. Los pasajeros ya pueden verlo y reservar.
            </p>
            {publishRouteWarning && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3 mb-6">
                No se pudo guardar la ruta en el mapa. El viaje está publicado igual.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/rides/${publishedRideId}`}
                className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition"
              >
                Ver viaje
              </Link>
              <Link
                href="/my-rides"
                className="px-6 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition"
              >
                Mis viajes
              </Link>
            </div>
          </div>
        </div>
      )}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-green-600">Xhare</Link>
          <div className="flex items-center gap-4">
            <UserRoleBadge />
            <button
              onClick={() => supabase.auth.signOut().then(() => router.push('/'))}
              className="px-4 py-2 text-gray-700 hover:text-green-600 transition"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Publicar un viaje</h1>

        {routeDistanceKm != null && (
          <div className="mb-4 space-y-3">
            <div className="p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-800">
                Distancia aproximada: <strong>{routeDistanceKm.toFixed(1)} km</strong>
                {routeDurationMinutes != null && (
                  <> · Duración estimada: <strong>{Math.round(routeDurationMinutes)} min</strong></>
                )}
              </p>
            </div>
          </div>
        )}

        {(waypoints.length > 0 || origin || destination) && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Recorrido</h3>
            <div className="space-y-1 text-sm">
              {origin && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Origen" />
                  <span className="text-gray-700">Origen: {origin.label || `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`}</span>
                </div>
              )}
              {waypoints.map((wp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs flex-shrink-0">{i + 1}</span>
                  <span className="text-gray-700 flex-1 min-w-0 truncate">{wp.label || `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (i === 0) return;
                        const next = [...waypoints];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setWaypoints(next);
                      }}
                      disabled={i === 0}
                      title="Subir"
                      className="p-1 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded disabled:opacity-30 disabled:pointer-events-none"
                    >↑</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (i === waypoints.length - 1) return;
                        const next = [...waypoints];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        setWaypoints(next);
                      }}
                      disabled={i === waypoints.length - 1}
                      title="Bajar"
                      className="p-1 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded disabled:opacity-30 disabled:pointer-events-none"
                    >↓</button>
                    <button
                      type="button"
                      onClick={() => setWaypoints(waypoints.filter((_, j) => j !== i))}
                      className="text-red-600 hover:text-red-800 text-xs"
                    >Quitar</button>
                  </div>
                </div>
              ))}
              {destination && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Destino" />
                  <span className="text-gray-700">Destino: {destination.label || `${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}`}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium mb-2">Origen *</label>
            <input
              type="text"
              value={originInput}
              onChange={(e) => {
                setOriginInput(e.target.value);
                searchAddresses(e.target.value, 'origin');
              }}
              onFocus={() => { if (originSuggestions.length > 0) setShowOriginSuggestions(true); }}
              onBlur={() => setTimeout(() => setShowOriginSuggestions(false), 200)}
              placeholder="Ciudad o dirección"
              className="w-full px-3 py-2 border rounded"
            />
            {showOriginSuggestions && originSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {originSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                    onClick={() => selectSuggestion(s, 'origin')}
                  >
                    {s.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium mb-2">Destino *</label>
            <input
              type="text"
              value={destinationInput}
              onChange={(e) => {
                setDestinationInput(e.target.value);
                searchAddresses(e.target.value, 'destination');
              }}
              onFocus={() => { if (destinationSuggestions.length > 0) setShowDestinationSuggestions(true); }}
              onBlur={() => setTimeout(() => setShowDestinationSuggestions(false), 200)}
              placeholder="Ciudad o dirección"
              className="w-full px-3 py-2 border rounded"
            />
            {showDestinationSuggestions && destinationSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {destinationSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                    onClick={() => selectSuggestion(s, 'destination')}
                  >
                    {s.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm text-gray-600 mb-2">
            {tripRequestIds.length > 0
              ? 'Círculos grises = subidas de pasajeros (solicitudes). Círculos gris azulado = bajadas. Marcá tu origen (recogida) y destino; la ruta se actualiza con OSRM.'
              : 'Paradas intermedias para marcar el recorrido. La ruta se actualizará también cuando aceptes pasajeros (máx. 1 km de desvío).'}
          </p>
          <div className="h-96 border rounded-lg mb-2 relative">
            <MapComponent
              pickup={origin}
              dropoff={destination}
              waypoints={waypoints}
              passengerPickups={tripRequestIds.length > 0 ? tripRequestsData.map((r) => ({ lat: r.origin_lat, lng: r.origin_lng, label: r.origin_label })) : undefined}
              passengerDropoffs={tripRequestIds.length > 0 ? tripRequestsData.map((r) => ({ lat: r.destination_lat, lng: r.destination_lng, label: r.destination_label })) : undefined}
              onPickupSelect={(point) => {
                if (addingWaypoint) addWaypointFromMap(point.lat, point.lng, point.label);
                else setOrigin(point);
              }}
              onDropoffSelect={(point) => {
                if (addingWaypoint) addWaypointFromMap(point.lat, point.lng, point.label);
                else setDestination(point);
              }}
              onRouteStatsChange={(stats) => {
                if (stats) {
                  setRouteDistanceKm(stats.distanceMeters / 1000);
                  setRouteDurationMinutes(stats.durationSeconds / 60);
                } else {
                  setRouteDistanceKm(null);
                  setRouteDurationMinutes(null);
                }
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => setAddingWaypoint(true)}
            className="text-green-600 hover:underline text-sm"
          >
            + Agregar parada en la ruta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Fecha de salida *</label>
              <input
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hora de salida *</label>
              <input
                type="time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Asientos disponibles</label>
            <p className="w-full px-3 py-2 border rounded bg-gray-50 text-gray-700">
              {userProfile?.vehicle_seat_count != null ? Number(userProfile.vehicle_seat_count) : availableSeats} (según el vehículo de tu cuenta)
            </p>
            <p className="text-sm text-gray-500 mt-1">
              ¿No es la cantidad que cargaste?{' '}
              <Link href="/driver/setup" className="text-green-600 hover:underline">
                Actualizá los datos de tu vehículo
              </Link>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Horario de salida</label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 has-[:checked]:border-green-500 has-[:checked]:bg-green-50">
              <input type="radio" name="flex" checked={departureFlexibility === 'strict_5'} onChange={() => setDepartureFlexibility('strict_5')} className="w-4 h-4 text-green-600" />
              <span>Salgo en el horario marcado (variación máx. 5 min)</span>
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 has-[:checked]:border-green-500 has-[:checked]:bg-green-50 mt-2">
              <input type="radio" name="flex" checked={departureFlexibility === 'flexible_30'} onChange={() => setDepartureFlexibility('flexible_30')} className="w-4 h-4 text-green-600" />
              <span>Hago la ruta, variación máx. 30 min</span>
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Vehículo (datos de tu cuenta)</label>
              <p className="w-full px-3 py-2 border rounded bg-gray-50 text-gray-700">
                {(userProfile?.vehicle_model ?? vehicleModel) || '—'} {userProfile?.vehicle_year ?? vehicleYear ? `(${userProfile?.vehicle_year ?? vehicleYear})` : ''}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Descripción (opcional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              rows={3}
              placeholder="Comparte información adicional sobre el viaje..."
            />
          </div>

          <div className="flex gap-4">
            <Link href="/my-rides" className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={submitting || !origin || !destination}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:bg-gray-400 font-semibold"
            >
              {submitting ? 'Publicando...' : 'Publicar viaje'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
