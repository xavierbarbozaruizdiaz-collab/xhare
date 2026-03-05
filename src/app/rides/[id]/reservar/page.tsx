'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { MapPoint, ExtraStopPoint } from '@/components/PickupDropoffMap';
import { baseFareFromDistanceKm, totalFareFromBaseAndSeats, MIN_FARE_PYG } from '@/lib/pricing/segment-fare';
import { getPositionAlongPolyline } from '@/lib/geo';

const PickupDropoffMap = dynamic(() => import('@/components/PickupDropoffMap'), { ssr: false });

export default function ReservarPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rideId = params.id as string;
  const isEditMode = searchParams.get('edit') === '1';
  const [ride, setRide] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [existingUserBooking, setExistingUserBooking] = useState<boolean>(false);
  const [existingBookingId, setExistingBookingId] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);
  const [pickup, setPickup] = useState<MapPoint>(null);
  const [dropoff, setDropoff] = useState<MapPoint>(null);
  const [segmentDistanceKm, setSegmentDistanceKm] = useState<number | null>(null);
  const [segmentBaseFare, setSegmentBaseFare] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Paradas de pasajeros que solicitaron trayecto (trip_requests aceptadas) para mostrarlas en la ruta al reservar */
  const [tripRequestPickups, setTripRequestPickups] = useState<Array<{ lat: number; lng: number; label?: string }>>([]);
  const [tripRequestDropoffs, setTripRequestDropoffs] = useState<Array<{ lat: number; lng: number; label?: string }>>([]);
  /** Ruta que pasa por todas las paradas (conductor + pasajeros); null = aún no calculada, se usa baseRoute */
  const [effectiveRoute, setEffectiveRoute] = useState<Array<{ lat: number; lng: number }> | null>(null);
  /** Paradas extra del pasajero actual (hasta 3 por viaje) */
  const [extraStops, setExtraStops] = useState<ExtraStopPoint[]>([]);

  useEffect(() => {
    if (!rideId) {
      setError('URL del viaje no válida.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        setUser(u);
        if (!u) {
          router.replace(`/login?next=${encodeURIComponent(`/rides/${rideId}/reservar`)}`);
          setLoading(false);
          return;
        }
        let rideRes = await supabase
          .from('rides')
          .select(`
            id, driver_id, available_seats, total_seats, price_per_seat, origin_label, destination_label,
            origin_lat, origin_lng, destination_lat, destination_lng,
            departure_time, base_route_polyline, max_deviation_km,
            driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count),
            ride_stops(lat, lng, label, stop_order)
          `)
          .eq('id', rideId)
          .maybeSingle();
        if (rideRes.error?.code === '42703' || rideRes.error?.message?.includes('column') || rideRes.error?.message?.includes('total_seats')) {
          rideRes = await supabase
            .from('rides')
            .select(`
              id, driver_id, available_seats, price_per_seat, origin_label, destination_label,
              origin_lat, origin_lng, destination_lat, destination_lng,
              departure_time, base_route_polyline, max_deviation_km,
              driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count)
            `)
            .eq('id', rideId)
            .maybeSingle();
        }
        const r = rideRes.data;
        const e = rideRes.error;
        if (e) {
          setError(e.message || 'No se pudo cargar el viaje.');
          setLoading(false);
          return;
        }
        if (!r) {
          setError('Viaje no encontrado o ya no está disponible.');
          setLoading(false);
          return;
        }
        setRide(r);

        if (!Array.isArray(r.ride_stops) || r.ride_stops.length === 0) {
          const { data: stopsData } = await supabase
            .from('ride_stops')
            .select('lat, lng, label, stop_order')
            .eq('ride_id', rideId)
            .order('stop_order', { ascending: true });
          if (stopsData && stopsData.length > 0) {
            setRide((prev: any) => (prev ? { ...prev, ride_stops: stopsData } : prev));
          }
        }

        const bksSelectWithSeats = 'id, passenger_id, seats_count, pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label, selected_seat_ids';
        const bksSelectWithoutSeats = 'id, passenger_id, seats_count, pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label';
        const bksRes1 = await supabase
          .from('bookings')
          .select(bksSelectWithSeats)
          .eq('ride_id', rideId)
          .neq('status', 'cancelled');
        let bks: any[];
        if (bksRes1.error?.code === '42703' || bksRes1.error?.message?.includes('column')) {
          const bksRes2 = await supabase
            .from('bookings')
            .select(bksSelectWithoutSeats)
            .eq('ride_id', rideId)
            .neq('status', 'cancelled');
          bks = (bksRes2.data ?? []).map((b: any) => ({ ...b, selected_seat_ids: null }));
        } else {
          bks = bksRes1.data ?? [];
        }
        setBookings(bks);

        const { data: tripRequestsRows } = await supabase
          .from('trip_requests')
          .select('origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label')
          .eq('ride_id', rideId)
          .eq('status', 'accepted');
        const trPickups = (tripRequestsRows || [])
          .filter((tr: any) => tr.origin_lat != null && tr.origin_lng != null)
          .map((tr: any) => ({ lat: Number(tr.origin_lat), lng: Number(tr.origin_lng), label: tr.origin_label ?? undefined }));
        const trDropoffs = (tripRequestsRows || [])
          .filter((tr: any) => tr.destination_lat != null && tr.destination_lng != null)
          .map((tr: any) => ({ lat: Number(tr.destination_lat), lng: Number(tr.destination_lng), label: tr.destination_label ?? undefined }));
        setTripRequestPickups(trPickups);
        setTripRequestDropoffs(trDropoffs);

        const mine = (bks || []).find((b: any) => b.passenger_id === u.id);
        setExistingUserBooking(!!mine);
        if (mine) {
          setExistingBookingId(mine.id);
          if (isEditMode) {
            setSeats(Math.max(1, mine.seats_count ?? 1));
            if (mine.pickup_lat != null && mine.pickup_lng != null) {
              setPickup({ lat: mine.pickup_lat, lng: mine.pickup_lng, label: mine.pickup_label ?? undefined });
            }
            if (mine.dropoff_lat != null && mine.dropoff_lng != null) {
              setDropoff({ lat: mine.dropoff_lat, lng: mine.dropoff_lng, label: mine.dropoff_label ?? undefined });
            }
          }
        }
        const { data: extraRows } = await supabase
          .from('passenger_extra_stops')
          .select('lat, lng, label, stop_order')
          .eq('ride_id', rideId);
        if (extraRows && Array.isArray(extraRows)) {
          const mapped: ExtraStopPoint[] = extraRows
            .filter((p: any) => p.lat != null && p.lng != null)
            .map((p: any) => ({
              lat: Number(p.lat),
              lng: Number(p.lng),
              label: p.label ?? null,
              order: Number(p.stop_order ?? 0),
            }))
            .sort((a, b) => a.order - b.order)
            .map((p, idx) => ({ ...p, order: idx + 1 }));
          setExtraStops(mapped);
        }
        if (r.driver_id === u.id) {
          setError('No podés reservar en tu propio viaje.');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [rideId, router, isEditMode]);

  // Calcular distancia y precio base del tramo (recogida → descenso) vía OSRM
  useEffect(() => {
    if (!pickup?.lat || !pickup?.lng || !dropoff?.lat || !dropoff?.lng) {
      setSegmentDistanceKm(null);
      setSegmentBaseFare(null);
      return;
    }
    let cancelled = false;
    setPriceLoading(true);
    fetch('/api/route/segment-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: pickup.lat, lng: pickup.lng },
        destination: { lat: dropoff.lat, lng: dropoff.lng },
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || data.error) return;
        const km = data.distanceKm != null ? Number(data.distanceKm) : null;
        if (km != null) {
          setSegmentDistanceKm(km);
          setSegmentBaseFare(baseFareFromDistanceKm(km));
        } else {
          setSegmentDistanceKm(null);
          setSegmentBaseFare(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSegmentDistanceKm(null);
          setSegmentBaseFare(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPriceLoading(false);
      });
    return () => { cancelled = true; };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  function getBaseRoute(): Array<{ lat: number; lng: number }> {
    if (!ride) return [];
    const poly = ride.base_route_polyline;
    if (Array.isArray(poly) && poly.length >= 2) {
      return poly.map((p: any) => ({ lat: p.lat ?? p[1], lng: p.lng ?? p[0] }));
    }
    const o = ride.origin_lat != null && ride.origin_lng != null ? { lat: ride.origin_lat, lng: ride.origin_lng } : null;
    const d = ride.destination_lat != null && ride.destination_lng != null ? { lat: ride.destination_lat, lng: ride.destination_lng } : null;
    if (o && d) return [o, d];
    return [];
  }

  const otherBookings = (bookings || []).filter((b: any) => b.passenger_id !== user?.id);
  const existingPickups = useMemo(() => [
    ...otherBookings
      .filter((b: any) => b.pickup_lat != null && b.pickup_lng != null)
      .map((b: any) => ({ lat: b.pickup_lat, lng: b.pickup_lng, label: b.pickup_label })),
    ...tripRequestPickups,
  ], [bookings, user?.id, tripRequestPickups]);
  const existingDropoffs = useMemo(() => [
    ...otherBookings
      .filter((b: any) => b.dropoff_lat != null && b.dropoff_lng != null)
      .map((b: any) => ({ lat: b.dropoff_lat, lng: b.dropoff_lng, label: b.dropoff_label })),
    ...tripRequestDropoffs,
  ], [bookings, user?.id, tripRequestDropoffs]);

  const basePolyline = useMemo(() => {
    if (!ride) return [];
    const poly = ride.base_route_polyline;
    if (Array.isArray(poly) && poly.length >= 2) {
      return poly.map((p: any) => ({ lat: p.lat ?? p[1], lng: p.lng ?? p[0] }));
    }
    const o = ride.origin_lat != null && ride.origin_lng != null ? { lat: ride.origin_lat, lng: ride.origin_lng } : null;
    const d = ride.destination_lat != null && ride.destination_lng != null ? { lat: ride.destination_lat, lng: ride.destination_lng } : null;
    return o && d ? [o, d] : [];
  }, [ride]);

  const driverIntermediateStops = useMemo(() => {
    if (!ride?.ride_stops || ride.ride_stops.length <= 2) return [];
    const sorted = [...ride.ride_stops].sort((a: any, b: any) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    return sorted.slice(1, -1).map((s: any) => ({ lat: s.lat, lng: s.lng })).filter((p: any) => p.lat != null && p.lng != null);
  }, [ride]);

  useEffect(() => {
    if (basePolyline.length < 2) {
      setEffectiveRoute(null);
      return;
    }
    const origin = basePolyline[0];
    const destination = basePolyline[basePolyline.length - 1];
    const allPoints: { point: { lat: number; lng: number }; pos: number }[] = [];
    driverIntermediateStops.forEach((p) => {
      allPoints.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    existingPickups.forEach((p) => {
      allPoints.push({ point: { lat: p.lat, lng: p.lng }, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    existingDropoffs.forEach((p) => {
      allPoints.push({ point: { lat: p.lat, lng: p.lng }, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    extraStops.forEach((s) => {
      allPoints.push({
        point: { lat: s.lat, lng: s.lng },
        pos: getPositionAlongPolyline({ lat: s.lat, lng: s.lng }, basePolyline),
      });
    });
    if (pickup?.lat != null && pickup?.lng != null) {
      allPoints.push({ point: { lat: pickup.lat, lng: pickup.lng }, pos: getPositionAlongPolyline(pickup, basePolyline) });
    }
    if (dropoff?.lat != null && dropoff?.lng != null) {
      allPoints.push({ point: { lat: dropoff.lat, lng: dropoff.lng }, pos: getPositionAlongPolyline(dropoff, basePolyline) });
    }
    allPoints.sort((a, b) => a.pos - b.pos);
    const waypoints = allPoints.map((x) => x.point);
    let cancelled = false;
    if (waypoints.length === 0) {
      setEffectiveRoute(basePolyline);
      return () => { cancelled = true; };
    }
    fetch('/api/route/polyline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination, waypoints }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const route = data.polyline;
        if (Array.isArray(route) && route.length >= 2) setEffectiveRoute(route);
        else setEffectiveRoute(basePolyline);
      })
      .catch(() => {
        if (!cancelled) setEffectiveRoute(basePolyline);
      });
    return () => { cancelled = true; };
  }, [basePolyline, driverIntermediateStops, existingPickups, existingDropoffs, extraStops, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  async function saveExtraStops(rideId: string, stops: ExtraStopPoint[]): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const payload = {
        stops: stops
          .slice(0, 3)
          .sort((a, b) => a.order - b.order)
          .map((s, idx) => ({
            lat: s.lat,
            lng: s.lng,
            label: s.label ?? null,
            order: idx + 1,
          })),
        access_token: token,
      };
      const res = await fetch(`/api/rides/${rideId}/extra-stops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok && process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('Error guardando paradas extra', await res.json().catch(() => ({})));
      }
    } catch {
      // No bloquear la reserva si fallan las paradas extra
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !ride || ride.driver_id === user.id) return;
    const baseRoute = getBaseRoute();
    if (baseRoute.length >= 2 && (!pickup || !dropoff)) {
      setError('Elegí tu punto de recogida y de descenso en el mapa.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const seatsToBook = Math.min(maxSeats, Math.max(1, seats));
    const baseFare = segmentBaseFare ?? MIN_FARE_PYG;
    const pricePaid = totalFareFromBaseAndSeats(baseFare, seatsToBook);
    const payload: Record<string, unknown> = {
      seats_count: seatsToBook,
      price_paid: pricePaid,
      pickup_lat: pickup?.lat ?? null,
      pickup_lng: pickup?.lng ?? null,
      pickup_label: pickup?.label ?? null,
      dropoff_lat: dropoff?.lat ?? null,
      dropoff_lng: dropoff?.lng ?? null,
      dropoff_label: dropoff?.label ?? null,
      selected_seat_ids: null,
    };
    if (existingBookingId) {
      const { error: err } = await supabase
        .from('bookings')
        .update(payload)
        .eq('id', existingBookingId)
        .eq('passenger_id', user.id);
      if (err) {
        setSubmitting(false);
        setError(err.message || 'No se pudo actualizar la reserva.');
        return;
      }
      await saveExtraStops(rideId, extraStops);
      setSubmitting(false);
      router.push('/my-bookings');
      return;
    }
    const { error: err } = await supabase.from('bookings').insert({
      ride_id: rideId,
      passenger_id: user.id,
      seats_count: payload.seats_count,
      price_paid: payload.price_paid,
      status: 'pending',
      payment_status: 'pending',
      ...payload,
      selected_seat_ids: null,
    });
    if (err) {
      setSubmitting(false);
      const isDuplicate = err.code === '23505' || /duplicate key|unique constraint|bookings_ride_id_passenger_id/i.test(err.message || '');
      if (isDuplicate) {
        setExistingUserBooking(true);
        setError(null);
      } else {
        setError(err.message || 'No se pudo crear la reserva.');
      }
      return;
    }
    await saveExtraStops(rideId, extraStops);
    setSubmitting(false);
    router.push('/my-bookings');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }
  if (error && !ride) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex flex-col items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-md text-center">
          <p className="text-red-600 font-medium mb-2">{error}</p>
          <p className="text-sm text-gray-600 mb-4">Probá volver a la búsqueda y elegir otro viaje.</p>
          <Link href="/search" className="inline-flex px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700">
            Volver a búsqueda
          </Link>
        </div>
      </div>
    );
  }
  if (!ride) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }

  const maxSeats = Math.max(0, ride.available_seats ?? 0);
  const baseRoute = getBaseRoute();
  const displayRoute = effectiveRoute ?? basePolyline;
  const maxDeviationKm = Number(ride.max_deviation_km ?? 1);
  const driver = ride.driver;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <header className="bg-white shadow-sm p-4 flex justify-between items-center mb-4 rounded-lg">
        <Link href={`/rides/${rideId}`} className="text-green-600 font-semibold">← Volver al viaje</Link>
        <Link href="/" className="text-2xl font-bold text-green-600">Xhare</Link>
      </header>
      <div className="max-w-lg mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-5">
          <h1 className="text-xl font-bold mb-2">{isEditMode && existingUserBooking ? 'Editar reserva' : 'Reservar asiento'}</h1>
          <p className="text-gray-600 text-sm mb-1">
            {ride.origin_label} → {ride.destination_label}
          </p>
          <p className="text-gray-500 text-sm mb-4">
            {ride.departure_time ? new Date(ride.departure_time).toLocaleString('es-PY') : ''} · Precio según tu tramo (recogida → descenso)
          </p>

          {/* Conductor: siempre visible para pasajeros (no es el viaje del usuario) */}
          {ride.driver_id !== user?.id && (
            <div className="mb-5 p-4 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tu chofer</p>
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold overflow-hidden">
                  {driver?.avatar_url ? (
                    <img src={driver.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (driver?.full_name || 'C').charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{driver?.full_name || 'Conductor'}</p>
                  <p className="text-sm text-gray-500">
                    {driver?.rating_average != null
                      ? `★ ${Number(driver.rating_average).toFixed(1)}`
                      : 'Nuevo'}
                    {driver?.rating_count != null && driver.rating_count > 0 && (
                      <span className="text-gray-400"> · {driver.rating_count} viaje{driver.rating_count !== 1 ? 's' : ''}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dónde se suben/bajan otros pasajeros */}
          {(existingPickups.length > 0 || existingDropoffs.length > 0) && (
            <div className="mb-5 p-4 rounded-xl bg-amber-50/80 border border-amber-100">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">Dónde se suben y bajan otros pasajeros</p>
              <ul className="text-sm text-gray-700 space-y-1">
                {existingPickups.map((p, i) => (
                  <li key={`pu-${i}`} className="flex gap-2">
                    <span className="text-green-600 font-medium">Subida:</span>
                    {p.label ? p.label.slice(0, 60) + (p.label.length > 60 ? '…' : '') : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}
                  </li>
                ))}
                {existingDropoffs.map((p, i) => (
                  <li key={`do-${i}`} className="flex gap-2">
                    <span className="text-amber-600 font-medium">Bajada:</span>
                    {p.label ? p.label.slice(0, 60) + (p.label.length > 60 ? '…' : '') : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className={`mb-4 p-3 rounded-lg text-sm flex flex-col gap-2 ${error.startsWith('Ya tenés') ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-red-50 text-red-700'}`}>
              <span>{error}</span>
              {error.startsWith('Ya tenés') && (
                <Link href="/my-bookings" className="text-green-600 font-medium hover:underline">
                  Ver mis reservas →
                </Link>
              )}
            </div>
          )}
          {existingUserBooking && !isEditMode ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="font-medium text-amber-900">Ya tenés una reserva en este viaje.</p>
              <p className="text-sm text-amber-800 mt-1 mb-3">Podés verla o cancelarla desde Mis reservas.</p>
              <Link href="/my-bookings" className="inline-flex items-center px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700">
                Ir a Mis reservas
              </Link>
            </div>
          ) : isEditMode && !existingUserBooking ? (
            <div className="p-4 rounded-xl bg-gray-100 border border-gray-200">
              <p className="text-gray-700">No tenés una reserva en este viaje para editar.</p>
              <Link href="/my-bookings" className="mt-2 inline-block text-green-600 font-medium hover:underline">Ver mis reservas</Link>
            </div>
          ) : ride.driver_id === user?.id ? (
            <p className="text-gray-500">No podés reservar en tu propio viaje.</p>
          ) : maxSeats < 1 ? (
            <p className="text-gray-500">No hay asientos disponibles.</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Mapa recogida / descenso: trayectoria que pasa por todas las paradas (conductor + pasajeros) */}
              {displayRoute.length >= 2 ? (
                <div>
                  <h2 className="text-sm font-semibold text-gray-700 mb-2">Elegí tu punto de recogida y descenso</h2>
                  <PickupDropoffMap
                    baseRoute={displayRoute}
                    maxDeviationKm={maxDeviationKm}
                    existingPickups={existingPickups}
                    existingDropoffs={existingDropoffs}
                    driverStops={Array.isArray(ride.ride_stops) ? ride.ride_stops : []}
                    pickup={pickup}
                    dropoff={dropoff}
                    onPickupChange={setPickup}
                    onDropoffChange={setDropoff}
                    extraStops={extraStops}
                    onExtraStopsChange={setExtraStops}
                    height="320px"
                  />
                  <p className="mt-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    Si la ruta se aleja mucho de donde querés ir y no te deja marcar un punto, probá elegir primero tu punto de descenso (B) y después el de recogida (A).
                  </p>
                </div>
              ) : (
                <p className="text-amber-700 text-sm bg-amber-50 p-3 rounded-lg">
                  Este viaje no tiene ruta definida en el mapa. La reserva se guardará sin puntos de recogida/descenso.
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cantidad de asientos</label>
                <p className="text-xs text-gray-500 mb-1">
                  Capacidad del móvil: {ride.total_seats ?? ride.available_seats ?? '—'} asientos · Disponibles: {maxSeats}
                </p>
                <input
                  type="number"
                  min={1}
                  max={maxSeats}
                  value={seats}
                  onChange={(e) => setSeats(Math.min(maxSeats, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
              {(baseRoute.length >= 2 && (!pickup || !dropoff)) ? (
                <p className="text-sm text-gray-500">Elegí recogida y descenso en el mapa para ver el precio.</p>
              ) : priceLoading ? (
                <p className="text-sm text-gray-500">Calculando precio...</p>
              ) : (
                <div className="p-3 bg-gray-50 rounded-lg space-y-1">
                  {segmentDistanceKm != null && (
                    <p className="text-sm text-gray-600">Tu tramo: <strong>{segmentDistanceKm.toFixed(1)} km</strong></p>
                  )}
                  <p className="text-sm text-gray-600">
                    Base (1 asiento): <strong>{(segmentBaseFare ?? MIN_FARE_PYG).toLocaleString('es-PY')} PYG</strong>
                  </p>
                  <p className="text-base font-semibold text-gray-900">
                    Total: {totalFareFromBaseAndSeats(segmentBaseFare ?? MIN_FARE_PYG, seats).toLocaleString('es-PY')} PYG
                  </p>
                </div>
              )}
              <button
                type="submit"
                disabled={
                  submitting ||
                  (baseRoute.length >= 2 && (!pickup || !dropoff))
                }
                className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (existingBookingId ? 'Guardando...' : 'Reservando...') : (existingBookingId ? 'Guardar cambios' : 'Confirmar reserva')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
