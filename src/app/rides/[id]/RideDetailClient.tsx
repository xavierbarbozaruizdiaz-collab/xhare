'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import * as platform from '@/lib/platform';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getPositionAlongPolyline } from '@/lib/geo';

const RideRouteMap = dynamic(() => import('@/components/RideRouteMap'), { ssr: false });

function shortLabel(label: string | null | undefined, max = 50): string {
  if (!label) return '—';
  const t = label.trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

export default function RideDetailClient() {
  const params = useParams();
  const router = useRouter();
  const rideId = params.id as string;
  const [ride, setRide] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [extraPassengerStops, setExtraPassengerStops] = useState<Array<{ lat: number; lng: number; label?: string | null }>>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [effectivePolyline, setEffectivePolyline] = useState<Array<{ lat: number; lng: number }> | null>(null);
  const [computedDurationMinutes, setComputedDurationMinutes] = useState<number | null>(null);
  const [publicInfo, setPublicInfo] = useState<{ booked_seats: number; pickups: Array<{ lat: number; lng: number; label?: string }>; dropoffs: Array<{ lat: number; lng: number; label?: string }> } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [boardingEvents, setBoardingEvents] = useState<Array<{ booking_id: string; stop_index: number; event_type: string }>>([]);
  const [arriveModalOpen, setArriveModalOpen] = useState(false);
  const [arriveDecisions, setArriveDecisions] = useState<Record<string, 'boarded' | 'no_show' | 'dropped_off'>>({});
  const [submittingArrive, setSubmittingArrive] = useState(false);
  const [hasRatedDriver, setHasRatedDriver] = useState(false);
  const [passengerRatingsGiven, setPassengerRatingsGiven] = useState<Set<string>>(new Set());
  const [passengerNames, setPassengerNames] = useState<Record<string, string>>({});
  const [rateDriverModalOpen, setRateDriverModalOpen] = useState(false);
  const [ratePassengerModalOpen, setRatePassengerModalOpen] = useState(false);
  const [rateDriverStars, setRateDriverStars] = useState(0);
  const [ratePassengerStars, setRatePassengerStars] = useState(0);
  const [passengerToRate, setPassengerToRate] = useState<{ passengerId: string; fullName: string } | null>(null);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [skippedRateDriver, setSkippedRateDriver] = useState(false);
  const [locationSendFailed, setLocationSendFailed] = useState(false);
  const locationFailCountRef = useRef(0);
  const [connectionLost, setConnectionLost] = useState(false);
  const [sessionExpiredBanner, setSessionExpiredBanner] = useState(false);
  const [driverSuspended, setDriverSuspended] = useState(false);
  const [openingNavigation, setOpeningNavigation] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadRide();
  }, [rideId]);

  // En la app la sesión puede restaurarse un poco después; reintentar carga para que currentUser se setee y se muestren los botones del conductor
  useEffect(() => {
    const t = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUser((prev: any) => (prev ? prev : user));
    }, 800);
    return () => clearTimeout(t);
  }, [rideId]);

  // Detección de conexión perdida (online/offline)
  useEffect(() => {
    const setOnline = () => setConnectionLost(false);
    const setOffline = () => setConnectionLost(true);
    if (typeof navigator !== 'undefined') {
      setConnectionLost(!navigator.onLine);
      window.addEventListener('online', setOnline);
      window.addEventListener('offline', setOffline);
      return () => {
        window.removeEventListener('online', setOnline);
        window.removeEventListener('offline', setOffline);
      };
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setOpeningNavigation(false);
        if (rideId) loadRide();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [rideId]);

  useEffect(() => {
    if (!ride || !currentUser || ride.driver_id === currentUser.id) return;
    const myB = (bookings || []).find((b: any) => b.passenger_id === currentUser.id);
    if (ride.status === 'completed' && myB && !hasRatedDriver && !skippedRateDriver && !rateDriverModalOpen) {
      setRateDriverModalOpen(true);
      setRateDriverStars(0);
    }
  }, [ride?.status, ride?.driver_id, currentUser?.id, bookings, hasRatedDriver, skippedRateDriver, rateDriverModalOpen]);

  // Actualizar datos del viaje (posición del conductor) cada 15 s cuando está en curso (producción)
  useEffect(() => {
    if (!rideId || ride?.status !== 'en_route') return;
    const interval = setInterval(loadRide, 15000);
    return () => clearInterval(interval);
  }, [rideId, ride?.status]);

  // Conductor: enviar ubicación cada 25 s (alineado con rate limit 15 s y carga en pasajeros)
  useEffect(() => {
    if (!rideId || !currentUser || ride?.driver_id !== currentUser.id || ride?.status !== 'en_route') return;
    const sendLocation = async () => {
      let { data: { session } } = await supabase.auth.getSession();
      let accessToken = session?.access_token;
      if (!accessToken) {
        await supabase.auth.refreshSession();
        const next = await supabase.auth.getSession();
        accessToken = next.data.session?.access_token;
      }
      if (!accessToken) return;

      const doPost = (token: string, lat: number, lng: number) =>
        fetch(`/api/rides/${rideId}/location`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lat, lng }),
        });

      const onPosition = async (lat: number, lng: number) => {
        let res = await doPost(accessToken!, lat, lng);
        if (res.status === 401) {
          const { data: { session: newSession } } = await supabase.auth.refreshSession();
          const newToken = newSession?.access_token;
          if (newToken) {
            res = await doPost(newToken, lat, lng);
            accessToken = newToken;
          }
        }
        if (res.ok) {
          locationFailCountRef.current = 0;
          setLocationSendFailed(false);
        } else if (res.status === 429) {
          locationFailCountRef.current = 0;
          setLocationSendFailed(false);
        } else {
          locationFailCountRef.current += 1;
          setLocationSendFailed(locationFailCountRef.current >= 2);
        }
      };

      const onError = () => {
        locationFailCountRef.current += 1;
        setLocationSendFailed(locationFailCountRef.current >= 2);
      };

      const pos = await platform.getCurrentPosition({ timeout: 10000, maxAge: 5000 });
      if (pos) void onPosition(pos.lat, pos.lng);
      else onError();
    };
    void sendLocation();
    const interval = setInterval(() => void sendLocation(), 25000);
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

  const extraStopsForMap = useMemo(
    () => extraPassengerStops.filter((p) => p.lat != null && p.lng != null),
    [extraPassengerStops]
  );

  // Paradas intermedias que marcó el conductor (origen y destino ya están en basePolyline)
  const driverIntermediateStops = useMemo(() => {
    if (!ride?.ride_stops || ride.ride_stops.length <= 2) return [];
    const sorted = [...ride.ride_stops].sort((a: any, b: any) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    return sorted.slice(1, -1).map((s: any) => ({ lat: s.lat, lng: s.lng })).filter((p: any) => p.lat != null && p.lng != null);
  }, [ride]);

  const firstNavigationTarget = useMemo(() => {
    if (!ride || basePolyline.length < 1) return null;
    const origin = basePolyline[0];
    const points: { point: { lat: number; lng: number }; pos: number }[] = [];

    driverIntermediateStops.forEach((p: { lat: number; lng: number }) => {
      points.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    passengerPickups.forEach((p: { lat: number; lng: number }) => {
      points.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });
    extraStopsForMap.forEach((p) => {
      points.push({ point: p, pos: getPositionAlongPolyline(p, basePolyline) });
    });

    if (points.length === 0) {
      return origin;
    }

    points.sort((a, b) => a.pos - b.pos);
    return points[0].point;
  }, [ride, basePolyline, driverIntermediateStops, passengerPickups, extraStopsForMap]);

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
    extraStopsForMap.forEach((p) => {
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
  }, [basePolyline, driverIntermediateStops, passengerPickups, passengerDropoffs, extraStopsForMap]);

  const stops = useMemo(() => {
    if (!ride) return [];
    return (ride.ride_stops && ride.ride_stops.length > 0)
      ? ride.ride_stops
          .map((s: any) => ({ lat: s.lat, lng: s.lng, label: s.label, stop_order: s.stop_order ?? 0 }))
          .filter((s: any) => s.lat != null && s.lng != null)
      : [
          { lat: ride.origin_lat, lng: ride.origin_lng, label: ride.origin_label, stop_order: 0 },
          { lat: ride.destination_lat, lng: ride.destination_lng, label: ride.destination_label, stop_order: 1 },
        ].filter((s: any) => s.lat != null && s.lng != null);
  }, [ride]);

  const sortedStops = useMemo(() => [...stops].sort((a: any, b: any) => (a.stop_order ?? 0) - (b.stop_order ?? 0)), [stops]);
  const currentStopIndex = useMemo(
    () => (ride ? Math.min(ride.current_stop_index ?? 0, Math.max(0, sortedStops.length - 1)) : 0),
    [ride, sortedStops]
  );
  const hasBoardingEvent = useCallback(
    (bookingId: string, stopIdx: number, eventType: string) =>
      boardingEvents.some((e) => e.booking_id === bookingId && e.stop_index === stopIdx && e.event_type === eventType),
    [boardingEvents]
  );
  const passengersAtCurrentStop = useMemo(() => {
    if (!ride || ride.status !== 'en_route' || basePolyline.length < 2) return [];
    const list: Array<{ bookingId: string; passengerId: string; type: 'pickup' | 'dropoff'; label: string }> = [];
    const stopPositions = sortedStops.map((s: any) => getPositionAlongPolyline({ lat: s.lat, lng: s.lng }, basePolyline));
    const getStopIndex = (lat: number, lng: number) => {
      const pos = getPositionAlongPolyline({ lat, lng }, basePolyline);
      let best = 0;
      let bestDist = Math.abs(stopPositions[0] - pos);
      for (let i = 1; i < stopPositions.length; i++) {
        const d = Math.abs(stopPositions[i] - pos);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    };
    (bookings || []).forEach((b: any) => {
      if (b.status === 'cancelled') return;
      const hasPickup = b.pickup_lat != null && b.pickup_lng != null;
      const hasDropoff = b.dropoff_lat != null && b.dropoff_lng != null;
      if (hasPickup) {
        const pickupIdx = getStopIndex(Number(b.pickup_lat), Number(b.pickup_lng));
        if (pickupIdx === currentStopIndex && !hasBoardingEvent(b.id, currentStopIndex, 'boarded') && !hasBoardingEvent(b.id, currentStopIndex, 'no_show')) {
          list.push({ bookingId: b.id, passengerId: b.passenger_id, type: 'pickup', label: b.pickup_label ? shortLabel(b.pickup_label, 30) : 'Recogida' });
        }
      }
      if (hasDropoff) {
        const dropoffIdx = getStopIndex(Number(b.dropoff_lat), Number(b.dropoff_lng));
        if (dropoffIdx === currentStopIndex && !hasBoardingEvent(b.id, currentStopIndex, 'dropped_off')) {
          list.push({ bookingId: b.id, passengerId: b.passenger_id, type: 'dropoff', label: b.dropoff_label ? shortLabel(b.dropoff_label, 30) : 'Bajada' });
        }
      }
    });
    return list;
  }, [ride, bookings, basePolyline, sortedStops, currentStopIndex, hasBoardingEvent]);

  const onboardCount = useMemo(() => {
    const hasBoard = (bId: string) => boardingEvents.some((e) => e.booking_id === bId && e.event_type === 'boarded');
    const hasDrop = (bId: string) => boardingEvents.some((e) => e.booking_id === bId && e.event_type === 'dropped_off');
    return (bookings || []).filter((b: any) => b.status !== 'cancelled' && hasBoard(b.id) && !hasDrop(b.id)).length;
  }, [bookings, boardingEvents]);

  async function loadRide() {
    setLoadError(false);
    try {
      // En app (WebView) la sesión puede no estar lista en el primer tick; forzar lectura del storage
      await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user ?? null);
      let data: any = null;
      const res = await supabase
        .from('rides')
        .select('*, driver:profiles!rides_driver_id_fkey(id, full_name, avatar_url, rating_average, rating_count), ride_stops(*)')
        .eq('id', rideId)
        .maybeSingle();
      if (!res.error && res.data) {
        data = {
          ...res.data,
          driver: Array.isArray(res.data.driver) ? res.data.driver[0] ?? null : res.data.driver ?? null,
        };
      }
      if (!data && user) {
        try {
          const { data: rpcDataRaw } = await supabase.rpc('get_ride_detail_for_user', { p_ride_id: rideId });
          const rpcData = Array.isArray(rpcDataRaw) && rpcDataRaw.length > 0 ? rpcDataRaw[0] : rpcDataRaw;
          if (rpcData && typeof rpcData === 'object' && (rpcData as any).ride) {
            const r = rpcData as {
              ride: Record<string, unknown>;
              ride_stops?: unknown[];
              driver_profile?: Record<string, unknown> | null;
              passenger_extra_stops?: Array<{ lat: number; lng: number; label?: string | null }>;
            };
            data = {
              ...r.ride,
              driver: r.driver_profile ?? null,
              ride_stops: Array.isArray(r.ride_stops) ? r.ride_stops : [],
            };
            if (Array.isArray(r.passenger_extra_stops)) {
              setExtraPassengerStops(
                r.passenger_extra_stops
                  .filter((p) => p.lat != null && p.lng != null)
                  .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), label: p.label ?? null }))
              );
            }
          }
        } catch (e) {
          console.error('[loadRide] RPC get_ride_detail_for_user failed:', e);
        }
      }
      if (!data) {
        router.push('/search');
        return;
      }
      setRide(data);
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

      const { data: extraRows } = await supabase
        .from('passenger_extra_stops')
        .select('lat, lng, label')
        .eq('ride_id', rideId);
      setExtraPassengerStops(
        (extraRows ?? [])
          .filter((p: any) => p.lat != null && p.lng != null)
          .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng), label: p.label ?? null }))
      );

      const { data: events } = await supabase
        .from('ride_boarding_events')
        .select('booking_id, stop_index, event_type')
        .eq('ride_id', rideId);
      setBoardingEvents(events ?? []);

      if (user && data.driver_id !== user.id) {
        const { data: dr } = await supabase
          .from('driver_ratings')
          .select('id')
          .eq('ride_id', rideId)
          .eq('passenger_id', user.id)
          .maybeSingle();
        setHasRatedDriver(!!dr);
      } else {
        setHasRatedDriver(false);
      }

      if (user && data.driver_id === user.id) {
        const { data: account } = await supabase
          .from('driver_accounts')
          .select('account_status')
          .eq('driver_id', user.id)
          .maybeSingle();
        setDriverSuspended(account?.account_status === 'suspended');
      } else {
        setDriverSuspended(false);
      }

      if (user && data.driver_id === user.id && bksRows.length > 0) {
        const pids = Array.from(new Set((bksRows as any[]).map((b: any) => b.passenger_id).filter(Boolean)));
        const { data: pr } = await supabase
          .from('passenger_ratings')
          .select('passenger_id')
          .eq('ride_id', rideId);
        setPassengerRatingsGiven(new Set((pr ?? []).map((r: any) => r.passenger_id)));
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', pids);
        const names: Record<string, string> = {};
        (profs ?? []).forEach((p: any) => { names[p.id] = p.full_name || 'Pasajero'; });
        setPassengerNames(names);
      } else {
        setPassengerNames({});
        setPassengerRatingsGiven(new Set());
      }

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
    } catch (_error) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function openNavigation(lat: number, lng: number, label?: string, _index?: number) {
    console.warn('[XHARE_NAV] Botón navegación pulsado (Ir al punto actual / parada)', { lat, lng });
    const latVal = lat != null ? Number(lat) : NaN;
    const lngVal = lng != null ? Number(lng) : NaN;
    if (typeof window === 'undefined' || !Number.isFinite(latVal) || !Number.isFinite(lngVal)) {
      if (typeof window !== 'undefined') alert('Punto sin ubicación');
      return;
    }
    setOpeningNavigation(true);
    const SAFETY_MS = 1500;
    const timeoutId = window.setTimeout(() => {
      setOpeningNavigation(false);
    }, SAFETY_MS);
    platform
      .openNavigation(latVal, lngVal, label ?? undefined)
      .catch(() => {
        if (typeof window !== 'undefined') alert('No se pudo abrir la navegación.');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        setOpeningNavigation(false);
      });
  }

  async function openNavigationToFirstPoint(): Promise<void> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    let lat: number | null = null;
    let lng: number | null = null;
    const target = firstNavigationTarget;
    if (target && target.lat != null && target.lng != null) {
      lat = target.lat;
      lng = target.lng;
    } else if (ride?.origin_lat != null && ride?.origin_lng != null) {
      lat = Number(ride.origin_lat);
      lng = Number(ride.origin_lng);
    }
    if (lat == null || lng == null) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('NAV_FIRST_POINT: no target (origen/paradas sin ubicación)');
      }
      return;
    }
    await platform.openNavigation(lat, lng, 'Origen / primer punto');
  }

  async function setRideStatus(newStatus: 'en_route' | 'completed') {
    if (!rideId || ride?.driver_id !== currentUser?.id || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      let {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const {
          data: { session: refreshed },
        } = await supabase.auth.refreshSession();
        session = refreshed ?? session;
      }
      const token = session?.access_token;
      if (!token) {
        setSessionExpiredBanner(true);
        router.push('/login?session_expired=1');
        return;
      }
      const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ride-update-status`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      let res: Response;
      try {
        res = await fetch(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ride_id: rideId, status: newStatus }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === 'AbortError') {
          alert('La solicitud tardó demasiado. Revisá tu conexión y volvé a intentar.');
        } else {
          alert('Error de conexión. Revisá tu conexión y volvé a intentar.');
        }
        return;
      }
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => ({}));
      if (process.env.NODE_ENV === 'development') {
        console.log('RIDE_UPDATE_STATUS_FN', { status: res.status, data });
      }
      if (!res.ok) {
        console.error('ride-update-status FAILED', {
          status: res.status,
          statusText: res.statusText,
          body: data,
        });
      }
      if (res.status === 401) {
        setSessionExpiredBanner(true);
        router.push('/login?session_expired=1');
        return;
      }
      if (!res.ok || !data?.ok) {
        const msg =
          data?.error === 'account_suspended'
            ? data?.details ??
              'Tu cuenta está suspendida por deuda pendiente. Contactá a soporte para regularizar.'
            : data?.error === 'already_has_active_ride'
              ? data?.details ?? 'Ya tenés un viaje en curso. Finalizá ese viaje antes de iniciar otro.'
              : newStatus === 'en_route'
                ? 'No se pudo iniciar el viaje. Volvé a intentar.'
                : 'No se pudo actualizar el estado del viaje. Volvé a intentar.';
        alert(msg);
        if (data?.error === 'account_suspended' || data?.error === 'already_has_active_ride') await loadRide();
        return;
      }
      // Actualización optimista: si acabamos de finalizar, el conductor ve el estado "completado" al instante
      if (newStatus === 'completed' && ride) {
        setRide((prev: any) => (prev ? { ...prev, status: 'completed' } : prev));
      }
      // Sincronizar con el servidor en background
      void loadRide();
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
      if (newStatus === 'en_route') {
        try {
          await Promise.race([
            openNavigationToFirstPoint().catch((err) => {
              if (process.env.NODE_ENV === 'development') console.warn('NAV_FIRST_POINT_IGNORED', err);
            }),
            new Promise((r) => setTimeout(r, 5000)),
          ]);
        } catch (e) {
          if (process.env.NODE_ENV === 'development') console.warn('EN_ROUTE_SETUP_IGNORED', e);
        }
      }
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleLlegue() {
    if (!rideId || ride?.driver_id !== currentUser?.id || ride?.status !== 'en_route' || ride?.awaiting_stop_confirmation) return;
    // Siempre refrescar sesión antes de acciones del viaje para no usar un token ya vencido en medio del viaje
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    const token = refreshed?.access_token ?? (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      alert('Tu sesión no está lista. Volvé a iniciar sesión.');
      return;
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    let res = await fetch(`/api/rides/${rideId}/set-awaiting-confirmation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ awaiting: true, access_token: token }),
    });
    if (res.status === 401) {
      const { data: { session: retrySession } } = await supabase.auth.refreshSession();
      const retryToken = retrySession?.access_token;
      if (retryToken) {
        res = await fetch(`/api/rides/${rideId}/set-awaiting-confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${retryToken}` },
          body: JSON.stringify({ awaiting: true, access_token: retryToken }),
        });
      }
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data?.error || 'No se pudo marcar llegada.');
      return;
    }
    setArriveDecisions({});
    setArriveModalOpen(true);
    await loadRide();
  }

  async function handleConfirmArrive() {
    if (!rideId || !allArriveDecisionsSet || submittingArrive) return;
    setSubmittingArrive(true);
    try {
      const passengers = passengersAtCurrentStop.map((p) => ({
        id: p.bookingId,
        action: (p.type === 'dropoff' ? 'dropped_off' : (arriveDecisions[decisionKey(p.bookingId, p.type)] ?? 'boarded')) as 'boarded' | 'no_show' | 'dropped_off',
      }));
      const droppedPassengerIds = passengersAtCurrentStop
        .filter((p) => p.type === 'dropoff')
        .map((p) => p.passengerId);
      // Siempre refrescar sesión para no fallar en medio del viaje por token vencido
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      const token = refreshed?.access_token ?? (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('Tu sesión no está lista. Volvé a iniciar sesión.');
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      const bodyPayload = { stopOrder: currentStop?.stop_order ?? currentStopIndex, passengers, access_token: token };
      let res = await fetch(`/api/rides/${rideId}/arrive`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
      });
      if (res.status === 401) {
        const { data: { session: retrySession } } = await supabase.auth.refreshSession();
        const retryToken = retrySession?.access_token;
        if (retryToken) {
          res = await fetch(`/api/rides/${rideId}/arrive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${retryToken}` },
            body: JSON.stringify({ ...bodyPayload, access_token: retryToken }),
          });
        }
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || 'No se pudo confirmar.');
        return;
      }
      setArriveModalOpen(false);
      setArriveDecisions({});
      await loadRide();
      if (droppedPassengerIds.length > 0) {
        const { data: pr } = await supabase.from('passenger_ratings').select('passenger_id').eq('ride_id', rideId);
        const rated = new Set((pr ?? []).map((r: any) => r.passenger_id));
        const firstToRate = droppedPassengerIds.find((id) => !rated.has(id));
        if (firstToRate) {
          setPassengerToRate({ passengerId: firstToRate, fullName: passengerNames[firstToRate] ?? 'Pasajero' });
          setRatePassengerStars(0);
          setRatePassengerModalOpen(true);
        }
      }
    } finally {
      setSubmittingArrive(false);
    }
  }

  function openNavigationToNextStop() {
    console.warn('[XHARE_NAV] Botón "Continuar viaje" pulsado');
    console.log('[NAV_FINAL_DEBUG]', { step: 'button_pressed', context: 'openNavigationToNextStop', env: process.env.NODE_ENV });
    if (typeof window === 'undefined' || !nextStop) return;
    const lat = nextStop.lat;
    const lng = nextStop.lng;
    if (lat == null || lng == null) {
      alert('Punto sin ubicación');
      return;
    }
    openNavigation(lat, lng, nextStop.label, currentStopIndex + 1);
  }

  async function handleSubmitRateDriver() {
    if (!rideId || rateDriverStars < 1 || rateDriverStars > 5 || submittingRating) return;
    setSubmittingRating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Tu sesión no está lista, volvé a iniciar sesión');
        return;
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('SESSION_CHECK', { hasToken: !!token });
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      const res = await fetch(`/api/rides/${rideId}/rate-driver`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ stars: rateDriverStars }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || 'No se pudo enviar la calificación.');
        return;
      }
      setRateDriverModalOpen(false);
      setHasRatedDriver(true);
      await loadRide();
    } finally {
      setSubmittingRating(false);
    }
  }

  async function handleSubmitRatePassenger() {
    if (!rideId || !passengerToRate || ratePassengerStars < 1 || ratePassengerStars > 5 || submittingRating) return;
    setSubmittingRating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Tu sesión no está lista, volvé a iniciar sesión');
        return;
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('SESSION_CHECK', { hasToken: !!token });
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      const res = await fetch(`/api/rides/${rideId}/rate-passenger`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ passengerId: passengerToRate.passengerId, stars: ratePassengerStars }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || 'No se pudo enviar la calificación.');
        return;
      }
      setRatePassengerModalOpen(false);
      setPassengerToRate(null);
      setPassengerRatingsGiven((prev) => new Set(prev).add(passengerToRate.passengerId));
      await loadRide();
    } finally {
      setSubmittingRating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 app-mobile-shell flex flex-col items-center justify-center p-6">
        <p className="text-gray-700 font-medium mb-2">Sin conexión</p>
        <p className="text-sm text-gray-500 mb-4 text-center">No se pudieron cargar los datos del viaje.</p>
        <button
          type="button"
          onClick={() => { setLoading(true); loadRide(); }}
          className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
        >
          Reintentar
        </button>
        <Link href="/search" className="mt-4 text-sm text-green-600 font-medium hover:underline">
          Volver a búsqueda
        </Link>
      </div>
    );
  }
  if (!ride) return null;

  const currentStop = sortedStops[currentStopIndex] ?? null;
  const nextStop = sortedStops[currentStopIndex + 1] ?? null;
  const decisionKey = (bookingId: string, type: 'pickup' | 'dropoff') => `${bookingId}-${type}`;
  const allArriveDecisionsSet = passengersAtCurrentStop.length === 0 || passengersAtCurrentStop.every((p) => {
    const d = arriveDecisions[decisionKey(p.bookingId, p.type)];
    if (p.type === 'dropoff') return d === 'dropped_off';
    return d === 'boarded' || d === 'no_show';
  });

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
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <header className="bg-white border-b border-gray-200 app-mobile-px py-4">
        <div className="flex justify-between items-center">
          <Link href="/search" className="text-xl md:text-2xl font-bold text-green-600">Xhare</Link>
          <Link
            href="/search"
            className="text-sm md:text-base text-gray-600 hover:text-green-600 font-medium"
          >
            ← Volver a búsqueda
          </Link>
        </div>
      </header>

      <div className="app-mobile-px py-4 md:py-6 max-w-2xl mx-auto">
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
          {ride?.status === 'en_route' && ride?.driver_id === currentUser?.id && (locationSendFailed || connectionLost) && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              {connectionLost
                ? 'Sin conexión. Los pasajeros no ven tu ubicación hasta que se recupere.'
                : 'No se pudo enviar la ubicación. Revisá la conexión o el GPS.'}
            </div>
          )}
          {/* Ruta en el mapa */}
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Ruta del viaje</h2>
            {(driverIntermediateStops.length > 0 || passengerPickups.length > 0 || passengerDropoffs.length > 0) && effectivePolyline && (
              <p className="text-xs text-green-700 mb-2">
                Ruta actualizada pasando por las paradas del conductor y por los puntos de recogida y descenso de los pasajeros.
              </p>
            )}
            <div className="app-map-container w-full">
              <RideRouteMap
                stops={stops}
                polyline={polyline.length >= 2 ? polyline : null}
                passengerPickups={passengerPickups}
                passengerDropoffs={passengerDropoffs}
                extraPassengerStops={extraStopsForMap}
                myPickup={myBooking && myBooking.pickup_lat != null && myBooking.pickup_lng != null ? { lat: myBooking.pickup_lat, lng: myBooking.pickup_lng, label: myBooking.pickup_label } : null}
                myDropoff={myBooking && myBooking.dropoff_lat != null && myBooking.dropoff_lng != null ? { lat: myBooking.dropoff_lat, lng: myBooking.dropoff_lng, label: myBooking.dropoff_label } : null}
                driverLocation={ride.status === 'en_route' && ride.driver_lat != null && ride.driver_lng != null ? { lat: Number(ride.driver_lat), lng: Number(ride.driver_lng) } : null}
                height="280px"
                className="rounded-lg overflow-hidden border border-gray-200"
              />
            </div>
            {ride.status === 'en_route' && ride.driver_id === currentUser?.id && (
              <>
                <p className="text-xs text-blue-600 mt-2">
                  Tu ubicación se comparte con los pasajeros cada 25 s.
                </p>
              </>
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
                  <li key={i} className="flex gap-2 items-center flex-wrap">
                    <span className="font-medium text-gray-400 w-5">{s.stop_order + 1}.</span>
                    <span>{s.label || `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}</span>
                    {s.lat != null && s.lng != null && (
                      <button
                        type="button"
                        onClick={() => openNavigation(s.lat, s.lng, s.label, s.stop_order)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Abrir en mapa
                      </button>
                    )}
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
          <div className="p-4 md:p-5 flex flex-col sm:flex-row gap-3 app-mobile-section">
            {ride.driver_id === currentUser?.id ? (
              <>
                {driverSuspended && (
                  <div className="w-full mb-2 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
                    <p className="font-medium">Cuenta suspendida</p>
                    <p className="text-sm mt-1">Tu cuenta está suspendida por deuda pendiente. No podés iniciar ni finalizar viajes hasta regularizar. Contactá a soporte.</p>
                  </div>
                )}
                {(ride.status === 'published' || ride.status === 'booked') && (
                  <button
                    type="button"
                    onClick={() => setRideStatus('en_route')}
                    disabled={updatingStatus || driverSuspended}
                    className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {updatingStatus ? '...' : driverSuspended ? 'Cuenta suspendida' : 'Iniciar viaje'}
                  </button>
                )}
                {ride.status === 'en_route' && (
                  <>
                    {ride.awaiting_stop_confirmation && (
                      <p className="text-sm text-amber-700 w-full">Confirmá pasajeros en el modal para poder continuar.</p>
                    )}
                    {!ride.awaiting_stop_confirmation && (
                      <button
                        type="button"
                        onClick={handleLlegue}
                        className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 transition"
                      >
                        Llegué
                      </button>
                    )}
                    {!ride.awaiting_stop_confirmation && currentStop && currentStop.lat != null && currentStop.lng != null && (
                      <button
                        type="button"
                        onClick={() => openNavigation(currentStop.lat!, currentStop.lng!, currentStop.label, currentStopIndex)}
                        disabled={openingNavigation}
                        className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-gray-700 text-white font-semibold rounded-xl hover:bg-gray-800 transition disabled:opacity-70"
                      >
                        {openingNavigation ? 'Abriendo…' : 'Ir al punto actual'}
                      </button>
                    )}
                    {!ride.awaiting_stop_confirmation && nextStop && (
                      <button
                        type="button"
                        onClick={openNavigationToNextStop}
                        disabled={openingNavigation}
                        className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition disabled:opacity-70"
                      >
                        {openingNavigation ? 'Abriendo…' : 'Continuar viaje'}
                      </button>
                    )}
                    {onboardCount > 0 && (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-green-100 text-green-800 text-sm font-medium">
                        A bordo: {onboardCount}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setRideStatus('completed')}
                      disabled={updatingStatus || driverSuspended}
                      className="flex-1 inline-flex justify-center items-center px-5 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50"
                    >
                      {updatingStatus ? 'Finalizando…' : driverSuspended ? 'Cuenta suspendida' : 'Finalizar viaje'}
                    </button>
                  </>
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

      {/* Modal Llegué: confirmar pasajeros en la parada */}
      {arriveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="arrive-modal-title">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
            <h2 id="arrive-modal-title" className="text-lg font-semibold text-gray-900 p-4 border-b border-gray-200">
              Llegada a parada {currentStop?.label ? shortLabel(currentStop.label, 40) : `#${currentStopIndex + 1}`}
            </h2>
            <div className="p-4 overflow-y-auto flex-1">
              {passengersAtCurrentStop.length === 0 ? (
                <p className="text-gray-600">No hay pasajeros en esta parada. Confirmá para continuar.</p>
              ) : (
                <ul className="space-y-3">
                  {passengersAtCurrentStop.map((p) => (
                    <li key={`${p.bookingId}-${p.type}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2 last:border-0">
                      <span className="text-sm text-gray-700">{p.label}</span>
                      {p.type === 'pickup' ? (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setArriveDecisions((prev) => ({ ...prev, [decisionKey(p.bookingId, p.type)]: 'boarded' }))}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${arriveDecisions[decisionKey(p.bookingId, p.type)] === 'boarded' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                          >
                            Subió
                          </button>
                          <button
                            type="button"
                            onClick={() => setArriveDecisions((prev) => ({ ...prev, [decisionKey(p.bookingId, p.type)]: 'no_show' }))}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${arriveDecisions[decisionKey(p.bookingId, p.type)] === 'no_show' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                          >
                            No subió
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setArriveDecisions((prev) => ({ ...prev, [decisionKey(p.bookingId, p.type)]: 'dropped_off' }))}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${arriveDecisions[decisionKey(p.bookingId, p.type)] === 'dropped_off' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                        >
                          Bajó
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  setArriveModalOpen(false);
                  const { data: { session } } = await supabase.auth.getSession();
                  const token = session?.access_token;
                  if (!token) {
                    alert('Tu sesión no está lista, volvé a iniciar sesión');
                    return;
                  }
                  if (process.env.NODE_ENV === 'development') {
                    console.log('SESSION_CHECK', { hasToken: !!token });
                  }
                  const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  };
                  await fetch(`/api/rides/${rideId}/set-awaiting-confirmation`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ awaiting: false }),
                  });
                  await loadRide();
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmArrive}
                disabled={!allArriveDecisionsSet || submittingArrive}
                className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submittingArrive ? '...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pasajero: Calificar chofer */}
      {rateDriverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="rate-driver-title">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h2 id="rate-driver-title" className="text-lg font-semibold text-gray-900 mb-3">Calificar chofer</h2>
            <p className="text-sm text-gray-600 mb-4">¿Cómo fue tu experiencia con el conductor?</p>
            <div className="flex gap-2 justify-center mb-6">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRateDriverStars(n)}
                  className={`w-10 h-10 rounded-full text-lg font-medium ${rateDriverStars >= n ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'}`}
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setRateDriverModalOpen(false); setSkippedRateDriver(true); }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
              >
                Omitir
              </button>
              <button
                type="button"
                onClick={handleSubmitRateDriver}
                disabled={rateDriverStars < 1 || submittingRating}
                className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
              >
                {submittingRating ? '...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal chofer: Calificar pasajero */}
      {ratePassengerModalOpen && passengerToRate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="rate-passenger-title">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h2 id="rate-passenger-title" className="text-lg font-semibold text-gray-900 mb-3">Calificar pasajero</h2>
            <p className="text-sm text-gray-600 mb-4">¿Cómo fue tu experiencia con <strong>{passengerToRate.fullName}</strong>?</p>
            <div className="flex gap-2 justify-center mb-6">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRatePassengerStars(n)}
                  className={`w-10 h-10 rounded-full text-lg font-medium ${ratePassengerStars >= n ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'}`}
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setRatePassengerModalOpen(false); setPassengerToRate(null); }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
              >
                Omitir
              </button>
              <button
                type="button"
                onClick={handleSubmitRatePassenger}
                disabled={ratePassengerStars < 1 || submittingRating}
                className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
              >
                {submittingRating ? '...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Banner: Sesión vencida */}
      {sessionExpiredBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-4 py-3 bg-amber-700 text-white text-center text-sm font-medium shadow-lg">
          Sesión vencida. Volvé a iniciar sesión.
        </div>
      )}
    </div>
  );
}
