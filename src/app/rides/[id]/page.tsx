'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getPositionAlongPolyline } from '@/lib/geo';

const RideRouteMap = dynamic(() => import('@/components/RideRouteMap'), { ssr: false });

function shortLabel(label: string | null | undefined, max = 50): string {
  if (!label) return '—';
  const t = label.trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

export default function RideDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rideId = params.id as string;
  const [ride, setRide] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [effectivePolyline, setEffectivePolyline] = useState<Array<{ lat: number; lng: number }> | null>(null);
  const [computedDurationMinutes, setComputedDurationMinutes] = useState<number | null>(null);
  const [publicInfo, setPublicInfo] = useState<{ booked_seats: number; pickups: Array<{ lat: number; lng: number; label?: string }>; dropoffs: Array<{ lat: number; lng: number; label?: string }> } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    loadRide();
  }, [rideId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && rideId) loadRide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [rideId]);

  // Actualizar datos del viaje (posición del conductor) cada 15 s cuando está en curso (producción)
  useEffect(() => {
    if (!rideId || ride?.status !== 'en_route') return;
    const interval = setInterval(loadRide, 15000);
    return () => clearInterval(interval);
  }, [rideId, ride?.status]);

  // Conductor: enviar ubicación cada 25 s (alineado con rate limit 15 s y carga en pasajeros)
  useEffect(() => {
    if (!rideId || !currentUser || ride?.driver_id !== currentUser.id || ride?.status !== 'en_route') return;
    const sendLocation = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetch(`/api/rides/${rideId}/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          }).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    };
    sendLocation();
    const interval = setInterval(sendLocation, 25000);
    return () => clearInterval(interval);
  }, [rideId, currentUser?.id, ride?.driver_id, ride?.status]);

  const basePolyline = useMemo(() => {
    if (!ride) return [];
    const p = ride.base_route_polyline;
    if (Array.isArray(p) && p.length >= 2) {
      return p.map((x: any) => ({ lat: x.lat ?? x[1], lng: x.lng ?? x[0] }));
    }
    const o = ride.origin_lat != null && ride.origin_lng != null ? { lat: ride.origin_lat, lng: ride.origin_lng } : null;
    const d = ride.destination_lat != null && ride.destination_lng != null ? { lat: ride.destination_lat, lng: ride.destination_lng } : null;
    return o && d ? [o, d] : [];
  }, [ride]);

  const passengerPickups = useMemo(() => {
    if (publicInfo) return publicInfo.pickups ?? [];
    return (bookings || [])
      .filter((b: any) => b.pickup_lat != null && b.pickup_lng != null)
      .map((b: any) => ({ lat: b.pickup_lat, lng: b.pickup_lng, label: b.pickup_label }));
  }, [publicInfo, bookings]);
  const passengerDropoffs = useMemo(() => {
    if (publicInfo) return publicInfo.dropoffs ?? [];
    return (bookings || [])
      .filter((b: any) => b.dropoff_lat != null && b.dropoff_lng != null)
      .map((b: any) => ({ lat: b.dropoff_lat, lng: b.dropoff_lng, label: b.dropoff_label }));
  }, [publicInfo, bookings]);

  // Paradas intermedias que marcó el conductor (origen y destino ya están en basePolyline)
  const driverIntermediateStops = useMemo(() => {
    if (!ride?.ride_stops || ride.ride_stops.length <= 2) return [];
    const sorted = [...ride.ride_stops].sort((a: any, b: any) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    return sorted.slice(1, -1).map((s: any) => ({ lat: s.lat, lng: s.lng })).filter((p: any) => p.lat != null && p.lng != null);
  }, [ride]);

  useEffect(() => {
    if (basePolyline.length < 2) {
      setEffectivePolyline(basePolyline.length ? basePolyline : null);
      setComputedDurationMinutes(null);
      return;
    }
    const origin = basePolyline[0];
    const destination = basePolyline[basePolyline.length - 1];
    const allPoints: { point: { lat: number; lng: number }; pos: number }[] = [];
    driverIntermediateStops.forEach((p: { lat: number; lng: number }) => {
      allPoints.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    passengerPickups.forEach((p: { lat: number; lng: number }) => {
      allPoints.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    passengerDropoffs.forEach((p: { lat: number; lng: number }) => {
      allPoints.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    allPoints.sort((a, b) => a.pos - b.pos);
    const waypoints = allPoints.map((x) => x.point);
    let cancelled = false;
    const setDuration = (data: { durationMinutes?: number }) => {
      if (cancelled) return;
      const min = data?.durationMinutes;
      setComputedDurationMinutes(min != null && min >= 1 ? min : null);
    };
    if (waypoints.length === 0) {
      setEffectivePolyline(basePolyline);
      fetch('/api/route/polyline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, waypoints: [] }),
      })
        .then((res) => res.json())
        .then(setDuration)
        .catch(() => {});
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
        setDuration(data);
        const route = data.polyline;
        if (Array.isArray(route) && route.length >= 2) setEffectivePolyline(route);
        else setEffectivePolyline(basePolyline);
      })
      .catch(() => {
        if (!cancelled) setEffectivePolyline(basePolyline);
      });
    return () => { cancelled = true; };
  }, [basePolyline, driverIntermediateStops, passengerPickups, passengerDropoffs]);

  async function loadRide() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user ?? null);
      const { data, error } = await supabase
        .from('rides')
        .select('*, driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count), ride_stops(*)')
        .eq('id', rideId)
        .maybeSingle();
      if (error || !data) {
        router.push('/search');
        return;
      }
      const rideNormalized = {
        ...data,
        driver: Array.isArray(data.driver) ? data.driver[0] ?? null : data.driver ?? null,
      };
      setRide(rideNormalized);
      const bksSelectWithSeats = 'id, passenger_id, seats_count, price_paid, pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label, selected_seat_ids';
      const bksSelectWithoutSeats = 'id, passenger_id, seats_count, price_paid, pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label';
      const bksRes1 = await supabase
        .from('bookings')
        .select(bksSelectWithSeats)
        .eq('ride_id', rideId)
        .neq('status', 'cancelled');
      let bksRows: any[];
      if (bksRes1.error?.code === '42703' || bksRes1.error?.message?.includes('column')) {
        const bksRes2 = await supabase
          .from('bookings')
          .select(bksSelectWithoutSeats)
          .eq('ride_id', rideId)
          .neq('status', 'cancelled');
        bksRows = (bksRes2.data ?? []).map((b: any) => ({ ...b, selected_seat_ids: null }));
      } else {
        bksRows = bksRes1.data ?? [];
      }
      setBookings(bksRows);

      const { data: tripRequestsRows } = await supabase
        .from('trip_requests')
        .select('origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label')
        .eq('ride_id', rideId)
        .eq('status', 'accepted');
      const tripPickups = (tripRequestsRows || [])
        .filter((tr: any) => tr.origin_lat != null && tr.origin_lng != null)
        .map((tr: any) => ({ lat: Number(tr.origin_lat), lng: Number(tr.origin_lng), label: tr.origin_label ?? undefined }));
      const tripDropoffs = (tripRequestsRows || [])
        .filter((tr: any) => tr.destination_lat != null && tr.destination_lng != null)
        .map((tr: any) => ({ lat: Number(tr.destination_lat), lng: Number(tr.destination_lng), label: tr.destination_label ?? undefined }));

      let pub: any = null;
      const { data: pubRows } = await supabase.rpc('get_ride_public_info', { p_ride_id: rideId });
      if (Array.isArray(pubRows) && pubRows[0]) pub = pubRows[0];
      let bookedSeats = 0;
      if (pub) {
        bookedSeats = Number(pub.booked_seats ?? 0);
        const pickups = Array.isArray(pub.pickups) ? pub.pickups.map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng), label: p.label })) : [];
        const dropoffs = Array.isArray(pub.dropoffs) ? pub.dropoffs.map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng), label: p.label })) : [];
        setPublicInfo({ booked_seats: bookedSeats, pickups, dropoffs });
      } else {
        const { data: seatRows } = await supabase.rpc('get_ride_booked_seats', { ride_ids: [rideId] });
        const bks = bksRows;
        const pickupsFromBookings = bks
          .filter((b: any) => b.pickup_lat != null && b.pickup_lng != null)
          .map((b: any) => ({ lat: Number(b.pickup_lat), lng: Number(b.pickup_lng), label: b.pickup_label ?? undefined }));
        const dropoffsFromBookings = bks
          .filter((b: any) => b.dropoff_lat != null && b.dropoff_lng != null)
          .map((b: any) => ({ lat: Number(b.dropoff_lat), lng: Number(b.dropoff_lng), label: b.dropoff_label ?? undefined }));
        if (Array.isArray(seatRows) && seatRows[0]) {
          bookedSeats = Number(seatRows[0].booked_seats ?? 0);
        } else {
          bookedSeats = bks.reduce((s: number, b: any) => s + Number(b.seats_count ?? 0), 0);
        }
        const pickups = [...pickupsFromBookings, ...tripPickups];
        const dropoffs = [...dropoffsFromBookings, ...tripDropoffs];
        setPublicInfo({ booked_seats: bookedSeats, pickups, dropoffs });
      }
    } catch (error) {
      router.push('/search');
    } finally {
      setLoading(false);
    }
  }

  async function setRideStatus(newStatus: 'en_route' | 'completed') {
    if (!rideId || ride?.driver_id !== currentUser?.id || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/rides/${rideId}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || 'No se pudo actualizar el estado.');
        return;
      }
      await loadRide();
      if (newStatus === 'en_route' && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Viaje en curso - Xhare', {
            body: 'Tu viaje está activo. Tocá para abrir la app.',
            tag: `ride-${rideId}`,
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch (_) {}
      }
      if (newStatus === 'en_route' && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } finally {
      setUpdatingStatus(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }
  if (!ride) return null;

  const stops = (ride.ride_stops && ride.ride_stops.length > 0)
    ? ride.ride_stops.map((s: any) => ({ lat: s.lat, lng: s.lng, label: s.label, stop_order: s.stop_order }))
    : [
        { lat: ride.origin_lat, lng: ride.origin_lng, label: ride.origin_label, stop_order: 0 },
        { lat: ride.destination_lat, lng: ride.destination_lng, label: ride.destination_label, stop_order: 1 },
      ].filter((s: any) => s.lat != null && s.lng != null);

  const driver = ride.driver;
  const polyline = effectivePolyline ?? basePolyline;
  const totalSeatsRide = Number(ride.total_seats ?? ride.available_seats ?? 15);
  const totalReservedRide = (bookings || []).reduce((s: number, b: any) => s + Number(b.seats_count ?? 0), 0);
  const remainingSeats = publicInfo != null
    ? Math.max(0, totalSeatsRide - Number(publicInfo.booked_seats))
    : Math.max(0, totalSeatsRide - totalReservedRide);
  const myBooking = currentUser && ride.driver_id !== currentUser?.id
    ? (bookings || []).find((b: any) => b.passenger_id === currentUser.id)
    : null;
  const samePoint = (a: { lat: number; lng: number }, b: { lat?: number | null; lng?: number | null }) =>
    b?.lat != null && b?.lng != null && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
  const otherPassengerPickups = myBooking
    ? passengerPickups.filter((p) => !samePoint(p, { lat: myBooking.pickup_lat, lng: myBooking.pickup_lng }))
    : passengerPickups;
  const otherPassengerDropoffs = myBooking
    ? passengerDropoffs.filter((p) => !samePoint(p, { lat: myBooking.dropoff_lat, lng: myBooking.dropoff_lng }))
    : passengerDropoffs;
  const departureDate = ride.departure_time
    ? new Date(ride.departure_time).toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
  const departureTime = ride.departure_time
    ? new Date(ride.departure_time).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const formatDuration = (minutes: number | null | undefined): string => {
    if (minutes == null || minutes < 1) return '—';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  };
  const durationMinutes = ride?.estimated_duration_minutes ?? computedDurationMinutes;
  const estimatedDurationLabel = formatDuration(durationMinutes);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="container mx-auto flex justify-between items-center">
          <Link href="/search" className="text-2xl font-bold text-green-600">Xhare</Link>
          <Link
            href="/search"
            className="text-gray-600 hover:text-green-600 font-medium"
          >
            ← Volver a búsqueda
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Aviso visible al tope cuando el usuario ya tiene reserva */}
        {myBooking && (
          <div className="mb-4 p-4 rounded-xl bg-green-600 text-white shadow-sm">
            <p className="font-semibold">Tenés una reserva en este viaje</p>
            <p className="text-sm text-green-100 mt-1">
              Reservaste <span className="font-semibold text-white">{Number(myBooking.seats_count ?? 0)}</span> asiento{(myBooking.seats_count ?? 0) !== 1 ? 's' : ''}
              {myBooking.price_paid != null && (
                <span> · <span className="font-semibold text-white">{Number(myBooking.price_paid).toLocaleString('es-PY')} PYG</span></span>
              )}
              . Quedan <span className="font-semibold text-white">{remainingSeats}</span> disponibles.
            </p>
            <Link
              href="/my-bookings"
              className="mt-3 inline-flex items-center px-4 py-2 bg-white text-green-700 font-semibold rounded-lg hover:bg-green-50 transition"
            >
              Ver en Mis reservas
            </Link>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Ruta en el mapa */}
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Ruta del viaje</h2>
            {(driverIntermediateStops.length > 0 || passengerPickups.length > 0 || passengerDropoffs.length > 0) && effectivePolyline && (
              <p className="text-xs text-green-700 mb-2">
                Ruta actualizada pasando por las paradas del conductor y por los puntos de recogida y descenso de los pasajeros.
              </p>
            )}
            <RideRouteMap
              stops={stops}
              polyline={polyline.length >= 2 ? polyline : null}
              passengerPickups={passengerPickups}
              passengerDropoffs={passengerDropoffs}
              myPickup={myBooking && myBooking.pickup_lat != null && myBooking.pickup_lng != null ? { lat: myBooking.pickup_lat, lng: myBooking.pickup_lng, label: myBooking.pickup_label } : null}
              myDropoff={myBooking && myBooking.dropoff_lat != null && myBooking.dropoff_lng != null ? { lat: myBooking.dropoff_lat, lng: myBooking.dropoff_lng, label: myBooking.dropoff_label } : null}
              driverLocation={ride.status === 'en_route' && ride.driver_lat != null && ride.driver_lng != null ? { lat: Number(ride.driver_lat), lng: Number(ride.driver_lng) } : null}
              height="280px"
              className="rounded-lg overflow-hidden border border-gray-200"
            />
            {ride.status === 'en_route' && ride.driver_id === currentUser?.id && (
              <p className="text-xs text-blue-600 mt-2">
                Tu ubicación se comparte con los pasajeros cada 25 s.
              </p>
            )}
            {(passengerPickups.length > 0 || passengerDropoffs.length > 0) && (
              <p className="text-xs text-gray-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {myBooking && (myBooking.pickup_lat != null || myBooking.dropoff_lat != null) ? (
                  <>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 align-middle mr-1" /> Tu recogida</span>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 align-middle mr-1" /> Tu bajada</span>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400 align-middle mr-1" /> Otros pasajeros</span>
                  </>
                ) : (
                  <>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 align-middle mr-1" /> Recogidas</span>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 align-middle mr-1" /> Bajadas</span>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Origen → Destino */}
          <div className="p-5 border-b border-gray-100">
            <p className="font-semibold text-gray-900" title={ride.origin_label ?? ''}>
              {shortLabel(ride.origin_label)}
            </p>
            <p className="text-sm text-gray-500 mt-1" title={ride.destination_label ?? ''}>
              → {shortLabel(ride.destination_label)}
            </p>
          </div>

          {/* Paradas (si hay más de origen y destino) */}
          {stops.length > 2 && (
            <div className="px-5 pb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Paradas</h3>
              <ol className="space-y-1.5 text-sm text-gray-600">
                {stops.map((s: any, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-medium text-gray-400 w-5">{s.stop_order + 1}.</span>
                    <span>{s.label || `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Fecha, hora, duración, precio, plazas */}
          <div className="px-5 py-4 flex flex-wrap gap-6 border-b border-gray-100">
            <div>
              <p className="text-xs text-gray-500 uppercase">Salida</p>
              <p className="font-medium text-gray-900">{departureDate}</p>
              <p className="text-sm text-gray-600">{departureTime}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Duración estimada</p>
              <p className="font-medium text-gray-900">{estimatedDurationLabel}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Precio</p>
              <p className="font-semibold text-green-600">
                {myBooking != null && (myBooking.price_paid != null && Number(myBooking.price_paid) >= 0)
                  ? `${Number(myBooking.price_paid).toLocaleString('es-PY')} PYG${myBooking.seats_count != null && Number(myBooking.seats_count) > 0 ? ` (${myBooking.seats_count} asiento${Number(myBooking.seats_count) !== 1 ? 's' : ''})` : ''}`
                  : ride.price_per_seat != null && Number(ride.price_per_seat) > 0
                    ? `${Number(ride.price_per_seat).toLocaleString('es-PY')} PYG por asiento`
                    : 'Según tu tramo (recogida y descenso)'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Asientos disponibles</p>
              <p className="font-medium text-gray-900">{remainingSeats}</p>
            </div>
          </div>

          {/* Conductor */}
          {driver && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Conductor</p>
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold overflow-hidden">
                  {driver.avatar_url ? (
                    <img src={driver.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (driver.full_name || 'C').charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{driver.full_name || 'Conductor'}</p>
                  <p className="text-sm text-gray-500">
                    {driver.rating_average != null
                      ? `★ ${Number(driver.rating_average).toFixed(1)}`
                      : 'Nuevo'}
                    {driver.rating_count != null && driver.rating_count > 0 && (
                      <span className="text-gray-400"> · {driver.rating_count} viaje{driver.rating_count !== 1 ? 's' : ''}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dónde se suben/bajan otros pasajeros */}
          {(otherPassengerPickups.length > 0 || otherPassengerDropoffs.length > 0) && (
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Dónde se suben y bajan otros pasajeros</h3>
              <ul className="space-y-1.5 text-sm text-gray-600">
                {otherPassengerPickups.map((p: any, i: number) => (
                  <li key={`pu-${i}`} className="flex gap-2">
                    <span className="text-green-600 font-medium shrink-0">Subida:</span>
                    <span>{p.label ? shortLabel(p.label, 60) : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</span>
                  </li>
                ))}
                {otherPassengerDropoffs.map((p: any, i: number) => (
                  <li key={`do-${i}`} className="flex gap-2">
                    <span className="text-amber-600 font-medium shrink-0">Bajada:</span>
                    <span>{p.label ? shortLabel(p.label, 60) : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Descripción */}
          {ride.description && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs text-gray-500 uppercase mb-1">Descripción</p>
              <p className="text-sm text-gray-700">{ride.description}</p>
            </div>
          )}

          {/* Tu reserva (resumen repetido abajo por si hace scroll) */}
          {myBooking && (
            <div className="px-5 py-4 border-b border-gray-100 bg-green-50/50 rounded-lg mx-5 mb-2">
              <p className="text-sm font-medium text-green-800">
                Reservaste <span className="font-semibold">{Number(myBooking.seats_count ?? 0)}</span> asiento{Number(myBooking.seats_count ?? 0) !== 1 ? 's' : ''}
                {myBooking.price_paid != null && (
                  <span className="text-green-700"> · {Number(myBooking.price_paid).toLocaleString('es-PY')} PYG</span>
                )}
                {Array.isArray(myBooking.selected_seat_ids) && myBooking.selected_seat_ids.length > 0 && (
                  <span className="text-green-700"> · Asientos: {myBooking.selected_seat_ids.join(', ')}</span>
                )}
              </p>
              <p className="text-sm text-gray-600 mt-0.5">
                Quedan <span className="font-medium">{remainingSeats}</span> asientos disponibles en el viaje.
              </p>
            </div>
          )}

          {/* Acciones */}
          <div className="p-5 flex flex-col sm:flex-row gap-3">
            {ride.driver_id === currentUser?.id ? (
              <>
                {(ride.status === 'published' || ride.status === 'booked') && (
                  <button
                    type="button"
                    onClick={() => setRideStatus('en_route')}
                    disabled={updatingStatus}
                    className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {updatingStatus ? '...' : 'Iniciar viaje'}
                  </button>
                )}
                {ride.status === 'en_route' && (
                  <button
                    type="button"
                    onClick={() => setRideStatus('completed')}
                    disabled={updatingStatus}
                    className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50"
                  >
                    {updatingStatus ? '...' : 'Finalizar viaje'}
                  </button>
                )}
                {ride.status !== 'en_route' && (
                  <Link
                    href={`/rides/${rideId}/edit`}
                    className="inline-flex justify-center items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                  >
                    Editar viaje
                  </Link>
                )}
                <Link
                  href="/my-rides"
                  className="inline-flex justify-center px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition"
                >
                  Mis viajes
                </Link>
              </>
            ) : (bookings || []).some((b: any) => b.passenger_id === currentUser?.id) ? (
              <Link
                href="/my-bookings"
                className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
              >
                Ya tenés una reserva · Ver en Mis reservas
              </Link>
            ) : remainingSeats > 0 && ride?.id ? (
              <Link
                href={`/rides/${ride.id}/reservar`}
                className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
              >
                Reservar asiento
              </Link>
            ) : null}
            <Link
              href="/search"
              className="inline-flex justify-center px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition"
            >
              Volver a búsqueda
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
