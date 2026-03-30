/**
 * Pasajero: reservar sobre la ruta publicada.
 * Gris: OSRM conductor + subidas/bajadas ya reservadas (una polyline). Verde: solo tramo del pasajero actual (A/B + extras + paradas del conductor en ese tramo).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { fetchSegmentStats } from '../backend/routeApi';
import { reverseGeocodeStructured } from '../backend/geocodeApi';
import { saveExtraStops } from '../backend/api';
import { fetchRideForReserve, fetchRidePublicMapPoints, type RideStopForReserve } from '../rides/api';
import { nearestRideStopIdForBookingPoint } from '../lib/bookingStopLink';
import { PickupDropoffMapView, type MapPoint, type ExtraStopPoint, type DriverStopMarker } from '../components/PickupDropoffMapView';
import { distanceMeters, getPositionAlongPolyline, type Point } from '../lib/geo';
import { loadRidePolyline } from '../lib/resolveRidePolyline';
import {
  loadActivePricingSettings,
  computeEffectivePricing,
  type EffectivePricing,
} from '../lib/pricing/runtime-pricing';
import {
  baseFareFromDistanceKmWithPricing,
  totalFareFromBaseAndSeatsWithPricing,
} from '../lib/pricing/segment-fare';
import { env } from '../core/env';
import type { MainStackParamList } from '../navigation/types';
import { buildMasterBookRidePolyline } from '../lib/buildMasterBookRidePolyline';
import { buildPassengerMergedRoute, type PassengerMergedSegments } from '../lib/passengerMergedRoute';
import { driverIntermediateStopsBetween, mergeOsrmWaypointsBetween } from '../lib/passengerRouteWaypoints';

type Nav = NativeStackNavigationProp<MainStackParamList, 'BookRide'>;
type ScreenRoute = RouteProp<MainStackParamList, 'BookRide'>;

/** Alineado a RideDetail: no duplicar pins si coinciden con la reserva propia (re-reserva / edición). */
const EXISTING_BOOKING_DEDUP_M = 35;

const FALLBACK_PRICING: EffectivePricing = {
  minFarePyg: 7140,
  pygPerKm: 2780,
  roundTo: 100,
  blockSize: 4,
  blockMultiplier: 1.5,
  pricingSettingsId: null,
};

function sortExtrasBetween(
  pickup: Point,
  dropoff: Point,
  extras: ExtraStopPoint[],
  baseRoute: Point[]
): Point[] {
  if (baseRoute.length < 2) return [];
  const pu = getPositionAlongPolyline(pickup, baseRoute);
  const du = getPositionAlongPolyline(dropoff, baseRoute);
  return [...extras]
    .map((s) => ({ p: { lat: s.lat, lng: s.lng } as Point, pos: getPositionAlongPolyline({ lat: s.lat, lng: s.lng }, baseRoute) }))
    .filter((x) => x.pos > pu && x.pos < du)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.p);
}

export function BookRideScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const { session } = useAuth();
  const rideId = route.params.rideId;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [driverStops, setDriverStops] = useState<DriverStopMarker[]>([]);
  /** Con ids de `ride_stops` para enlazar pickup/dropoff en la reserva. */
  const [stopsForBookLink, setStopsForBookLink] = useState<RideStopForReserve[]>([]);
  const [existingPickups, setExistingPickups] = useState<Array<{ lat: number; lng: number; label?: string | null }>>([]);
  const [existingDropoffs, setExistingDropoffs] = useState<Array<{ lat: number; lng: number; label?: string | null }>>([]);
  const [seats, setSeats] = useState(1);
  const [pickup, setPickup] = useState<MapPoint>(null);
  const [dropoff, setDropoff] = useState<MapPoint>(null);
  const [extraStops, setExtraStops] = useState<ExtraStopPoint[]>([]);
  const [segmentDistanceKm, setSegmentDistanceKm] = useState<number | null>(null);
  const [segmentBaseFare, setSegmentBaseFare] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [effectivePricing, setEffectivePricing] = useState<EffectivePricing>(FALLBACK_PRICING);
  const [existingBooking, setExistingBooking] = useState(false);
  /** Ruta publicada del conductor (solo referencia interna + orden para OSRM maestro). */
  const [resolvedRoute, setResolvedRoute] = useState<Point[]>([]);
  const [routeResolving, setRouteResolving] = useState(false);
  /** Polilínea gris del mapa: conductor + pasajeros ya reservados (OSRM) o igual a `resolvedRoute` si no hay otros. */
  const [mapDisplayRoute, setMapDisplayRoute] = useState<Point[]>([]);
  const [masterGreyResolving, setMasterGreyResolving] = useState(false);
  const [mergedPassengerRoute, setMergedPassengerRoute] = useState<PassengerMergedSegments | null>(null);

  const rideRef = useRef<Record<string, unknown> | null>(null);
  const driverStopsRef = useRef(driverStops);
  /** Mismo A/B y misma poly base: permite retener solo si el intento OSRM es para los **mismos** waypoints (no dejar colado un merge sin puntos de otros). */
  const lastSuccessfulMergeStableKeyRef = useRef<string>('');
  const lastSuccessfulWpsKeyRef = useRef<string>('');
  rideRef.current = ride;
  driverStopsRef.current = driverStops;

  const polyLen = ride
    ? Array.isArray(ride.base_route_polyline)
      ? (ride.base_route_polyline as unknown[]).length
      : 0
    : 0;
  const stopsKey = useMemo(
    () => driverStops.map((s) => `${s.lat},${s.lng},${s.stop_order}`).join('|'),
    [driverStops]
  );

  useEffect(() => {
    if (!rideId || !rideRef.current) {
      setResolvedRoute([]);
      setRouteResolving(false);
      return;
    }
    let cancelled = false;
    setRouteResolving(true);
    void loadRidePolyline(rideRef.current, driverStopsRef.current)
      .then((r) => {
        if (cancelled) return;
        setResolvedRoute(r.points);
      })
      .finally(() => {
        if (!cancelled) setRouteResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rideId, polyLen, stopsKey]);

  useEffect(() => {
    if (resolvedRoute.length < 2) {
      setMapDisplayRoute([]);
      setMasterGreyResolving(false);
      return;
    }
    const hasOthers = existingPickups.length + existingDropoffs.length > 0;
    if (!hasOthers || !env.apiBaseUrl?.trim()) {
      setMapDisplayRoute(resolvedRoute);
      setMasterGreyResolving(false);
      return;
    }
    setMapDisplayRoute(resolvedRoute);
    let cancelled = false;
    setMasterGreyResolving(true);
    void buildMasterBookRidePolyline({
      driverBaseRoute: resolvedRoute,
      driverStops,
      existingPickups: existingPickups.map((p) => ({ lat: p.lat, lng: p.lng })),
      existingDropoffs: existingDropoffs.map((p) => ({ lat: p.lat, lng: p.lng })),
    }).then((pts) => {
      if (cancelled) return;
      setMapDisplayRoute(pts.length >= 2 ? pts : resolvedRoute);
    }).finally(() => {
      if (!cancelled) setMasterGreyResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedRoute, stopsKey, existingPickups, existingDropoffs, env.apiBaseUrl]);

  const maxDeviationMeters = useMemo(() => {
    const km = ride ? Number((ride as { max_deviation_km?: number }).max_deviation_km ?? 1) : 1;
    return Math.max(200, km * 1000);
  }, [ride]);

  const maxSeats = Math.max(0, Number(ride?.available_seats ?? 0));
  const fixedSeatPrice = Math.max(0, Number(ride?.price_per_seat ?? 0));
  const usesDriverSeatPrice = fixedSeatPrice > 0;

  const extraStopsKey = useMemo(
    () => extraStops.map((s) => `${s.lat},${s.lng},${s.order}`).join('|'),
    [extraStops]
  );

  /** OSRM verde / precio: solo extras del pasajero actual + paradas del conductor entre A y B (otros ya van en la gris). */
  const waypointsBetween = useMemo(() => {
    if (!pickup || !dropoff || mapDisplayRoute.length < 2) return [];
    const extras = sortExtrasBetween(pickup, dropoff, extraStops, mapDisplayRoute);
    const drv = driverIntermediateStopsBetween(mapDisplayRoute, pickup, dropoff, driverStops);
    return mergeOsrmWaypointsBetween(mapDisplayRoute, pickup, dropoff, extras, drv, []);
  }, [
    pickup?.lat,
    pickup?.lng,
    dropoff?.lat,
    dropoff?.lng,
    extraStopsKey,
    mapDisplayRoute,
    stopsKey,
  ]);

  const mapDisplayRouteSig = useMemo(() => {
    if (mapDisplayRoute.length < 2) return '';
    const a = mapDisplayRoute[0];
    const b = mapDisplayRoute[mapDisplayRoute.length - 1];
    return `${mapDisplayRoute.length}|${a.lat},${a.lng}|${b.lat},${b.lng}`;
  }, [mapDisplayRoute]);

  const mergeStableKey = useMemo(() => {
    if (!pickup || !dropoff || !mapDisplayRouteSig) return '';
    return `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}|${mapDisplayRouteSig}`;
  }, [pickup, dropoff, mapDisplayRouteSig]);

  const waypointsBetweenKey = useMemo(
    () => waypointsBetween.map((p) => `${p.lat},${p.lng}`).join(';'),
    [waypointsBetween]
  );

  useEffect(() => {
    let c = false;
    loadActivePricingSettings().then((row) => {
      if (c) return;
      setEffectivePricing(row ? computeEffectivePricing(row) : FALLBACK_PRICING);
    });
    return () => {
      c = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!session?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRideForReserve(rideId);
      if (!res?.ride) {
        setError('Viaje no encontrado o no disponible.');
        setRide(null);
        setLoading(false);
        return;
      }
      const r = res.ride;
      if (r.driver_id === session.id) {
        setError('No podés reservar tu propio viaje.');
        setRide(null);
        setLoading(false);
        return;
      }
      setRide(r);
      setStopsForBookLink(res.ride_stops);
      setDriverStops(
        res.ride_stops.map((s) => ({
          lat: s.lat,
          lng: s.lng,
          label: s.label,
          stop_order: s.stop_order,
        }))
      );

      const bksRes = await supabase
        .from('bookings')
        .select(
          'passenger_id, pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label'
        )
        .eq('ride_id', rideId)
        .neq('status', 'cancelled');
      const bks = bksRes.data ?? [];
      const mine = bks.find((b: { passenger_id: string }) => b.passenger_id === session.id);
      setExistingBooking(!!mine);

      /**
       * Puntos de otros pasajeros: el SELECT directo a `bookings` solo ve otras filas si el viaje está
       * `published` (RLS). En `booked` / `en_route` un nuevo reservista no ve nada → usamos RPC público.
       */
      const { pickups: pubPu, dropoffs: pubDo } = await fetchRidePublicMapPoints(rideId);
      const mineExclude: Point[] = [];
      if (mine) {
        const m = mine as Record<string, unknown>;
        const plat = m.pickup_lat != null ? Number(m.pickup_lat) : NaN;
        const plng = m.pickup_lng != null ? Number(m.pickup_lng) : NaN;
        const dlat = m.dropoff_lat != null ? Number(m.dropoff_lat) : NaN;
        const dlng = m.dropoff_lng != null ? Number(m.dropoff_lng) : NaN;
        if ([plat, plng].every(Number.isFinite)) mineExclude.push({ lat: plat, lng: plng });
        if ([dlat, dlng].every(Number.isFinite)) mineExclude.push({ lat: dlat, lng: dlng });
      }
      const filterDedup = (pts: Point[]) =>
        mineExclude.length === 0
          ? pts
          : pts.filter((p) => !mineExclude.some((e) => distanceMeters(p, e) < EXISTING_BOOKING_DEDUP_M));

      let nextPickups = filterDedup(pubPu).map((p) => ({ lat: p.lat, lng: p.lng, label: null as string | null }));
      let nextDropoffs = filterDedup(pubDo).map((p) => ({ lat: p.lat, lng: p.lng, label: null as string | null }));

      if (nextPickups.length === 0 && nextDropoffs.length === 0) {
        const others = bks.filter((b: { passenger_id: string }) => b.passenger_id !== session.id);
        nextPickups = others
          .filter((b: Record<string, unknown>) => b.pickup_lat != null && b.pickup_lng != null)
          .map((b: Record<string, unknown>) => ({
            lat: Number(b.pickup_lat),
            lng: Number(b.pickup_lng),
            label: (b.pickup_label as string | null) ?? null,
          }));
        nextDropoffs = others
          .filter((b: Record<string, unknown>) => b.dropoff_lat != null && b.dropoff_lng != null)
          .map((b: Record<string, unknown>) => ({
            lat: Number(b.dropoff_lat),
            lng: Number(b.dropoff_lng),
            label: (b.dropoff_label as string | null) ?? null,
          }));
        const { data: trRows } = await supabase
          .from('trip_requests')
          .select('origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label')
          .eq('ride_id', rideId)
          .eq('status', 'accepted');
        const trPickups = (trRows ?? [])
          .filter((tr: Record<string, unknown>) => tr.origin_lat != null && tr.origin_lng != null)
          .map((tr: Record<string, unknown>) => ({
            lat: Number(tr.origin_lat),
            lng: Number(tr.origin_lng),
            label: (tr.origin_label as string | null) ?? null,
          }));
        const trDropoffs = (trRows ?? [])
          .filter((tr: Record<string, unknown>) => tr.destination_lat != null && tr.destination_lng != null)
          .map((tr: Record<string, unknown>) => ({
            lat: Number(tr.destination_lat),
            lng: Number(tr.destination_lng),
            label: (tr.destination_label as string | null) ?? null,
          }));
        nextPickups = [...nextPickups, ...trPickups];
        nextDropoffs = [...nextDropoffs, ...trDropoffs];
      }

      setExistingPickups(nextPickups);
      setExistingDropoffs(nextDropoffs);

      const { data: pes } = await supabase
        .from('passenger_extra_stops')
        .select('lat, lng, label, stop_order')
        .eq('ride_id', rideId)
        .eq('passenger_id', session.id)
        .order('stop_order', { ascending: true });
      if (pes?.length) {
        setExtraStops(
          pes.map((p: { lat: number; lng: number; label?: string | null; stop_order?: number }, i: number) => ({
            lat: Number(p.lat),
            lng: Number(p.lng),
            label: p.label ?? null,
            order: i + 1,
          }))
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [rideId, session?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (segmentDistanceKm == null) {
      setSegmentBaseFare(null);
      return;
    }
    setSegmentBaseFare(baseFareFromDistanceKmWithPricing(segmentDistanceKm, effectivePricing));
  }, [segmentDistanceKm, effectivePricing]);

  useEffect(() => {
    if (usesDriverSeatPrice) {
      setSegmentDistanceKm(null);
      setPriceLoading(false);
      return;
    }
    if (!pickup || !dropoff || !env.apiBaseUrl?.trim()) {
      setSegmentDistanceKm(null);
      return;
    }
    let cancelled = false;
    setPriceLoading(true);
    fetchSegmentStats(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: dropoff.lat, lng: dropoff.lng },
      waypointsBetween
    ).then((res) => {
      if (cancelled) return;
      if (res.error || res.distanceKm == null) {
        setSegmentDistanceKm(null);
        return;
      }
      setSegmentDistanceKm(res.distanceKm);
    }).finally(() => {
      if (!cancelled) setPriceLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, waypointsBetween, usesDriverSeatPrice]);

  useEffect(() => {
    if (!pickup || !dropoff || mapDisplayRoute.length < 2 || !env.apiBaseUrl?.trim()) {
      lastSuccessfulMergeStableKeyRef.current = '';
      lastSuccessfulWpsKeyRef.current = '';
      setMergedPassengerRoute(null);
      return;
    }
    if (!mergeStableKey) {
      lastSuccessfulMergeStableKeyRef.current = '';
      lastSuccessfulWpsKeyRef.current = '';
      setMergedPassengerRoute(null);
      return;
    }

    let cancelled = false;
    const wpsFingerprint = (wps: Point[]) => wps.map((p) => `${p.lat},${p.lng}`).join(';');
    const tryMerge = (wps: Point[], isMinimalRetry: boolean) => {
      void buildPassengerMergedRoute(mapDisplayRoute, pickup, dropoff, wps).then((seg) => {
        if (cancelled) return;
        const ok = Boolean(seg && seg.mid && seg.mid.length >= 2);
        const fp = wpsFingerprint(wps);
        if (ok) {
          lastSuccessfulMergeStableKeyRef.current = mergeStableKey;
          lastSuccessfulWpsKeyRef.current = fp;
          setMergedPassengerRoute(seg);
          return;
        }
        if (
          lastSuccessfulMergeStableKeyRef.current === mergeStableKey &&
          lastSuccessfulWpsKeyRef.current === fp
        ) {
          setMergedPassengerRoute((prev) => prev);
          return;
        }
        if (!isMinimalRetry && waypointsBetween.length > 0) {
          tryMerge([], true);
          return;
        }
        setMergedPassengerRoute(null);
      });
    };

    const handle = setTimeout(() => {
      tryMerge(waypointsBetween, false);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mergeStableKey, waypointsBetweenKey, waypointsBetween, pickup, dropoff, mapDisplayRoute]);

  const totalPrice = usesDriverSeatPrice
    ? fixedSeatPrice * Math.min(maxSeats, Math.max(1, seats))
    : segmentBaseFare != null
      ? totalFareFromBaseAndSeatsWithPricing(
          segmentBaseFare,
          Math.min(maxSeats, Math.max(1, seats)),
          effectivePricing
        )
      : null;

  const handleSubmit = async () => {
    if (!session?.id || !ride) return;
    if (existingBooking) {
      Alert.alert('Reserva', 'Ya tenés una reserva en este viaje.');
      return;
    }
    if (maxSeats < 1) {
      Alert.alert('Cupos', 'No hay asientos disponibles.');
      return;
    }
    if (mapDisplayRoute.length >= 2 && (!pickup || !dropoff)) {
      Alert.alert('Mapa', 'Marcá subida (A) y bajada (B) en la ruta.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const seatsToBook = Math.min(maxSeats, Math.max(1, seats));
      const baseFare = usesDriverSeatPrice
        ? fixedSeatPrice
        : segmentBaseFare ?? effectivePricing.minFarePyg;
      const pricePaid = usesDriverSeatPrice
        ? fixedSeatPrice * seatsToBook
        : totalFareFromBaseAndSeatsWithPricing(baseFare, seatsToBook, effectivePricing);
      const [puLabel, doLabel] = await Promise.all([
        pickup ? reverseGeocodeStructured(pickup.lat, pickup.lng) : Promise.resolve({ displayName: '' }),
        dropoff ? reverseGeocodeStructured(dropoff.lat, dropoff.lng) : Promise.resolve({ displayName: '' }),
      ]);
      const pricingSnapshot = {
        effective: {
          minFarePyg: effectivePricing.minFarePyg,
          pygPerKm: effectivePricing.pygPerKm,
          roundTo: effectivePricing.roundTo,
          blockSize: effectivePricing.blockSize,
          blockMultiplier: effectivePricing.blockMultiplier,
        },
        pricing_settings_id: effectivePricing.pricingSettingsId,
        segment_distance_km: usesDriverSeatPrice ? undefined : segmentDistanceKm ?? undefined,
        base_fare: baseFare,
        seats: seatsToBook,
        total: pricePaid,
        pricing_mode: usesDriverSeatPrice ? 'driver_seat_price' : 'segment',
      };
      const linkRows = stopsForBookLink.filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lng));
      const pickup_stop_id =
        pickup && linkRows.length > 0 ? nearestRideStopIdForBookingPoint(linkRows, pickup.lat, pickup.lng) : null;
      const dropoff_stop_id =
        dropoff && linkRows.length > 0 ? nearestRideStopIdForBookingPoint(linkRows, dropoff.lat, dropoff.lng) : null;

      const payload = {
        ride_id: rideId,
        passenger_id: session.id,
        seats_count: seatsToBook,
        price_paid: pricePaid,
        status: 'pending',
        payment_status: 'pending',
        pickup_lat: pickup?.lat ?? null,
        pickup_lng: pickup?.lng ?? null,
        pickup_label: pickup ? puLabel.displayName.slice(0, 500) : null,
        dropoff_lat: dropoff?.lat ?? null,
        dropoff_lng: dropoff?.lng ?? null,
        dropoff_label: dropoff ? doLabel.displayName.slice(0, 500) : null,
        pickup_stop_id,
        dropoff_stop_id,
        selected_seat_ids: null,
        pricing_snapshot: pricingSnapshot,
        pricing_settings_id: effectivePricing.pricingSettingsId,
        segment_distance_km: usesDriverSeatPrice ? null : segmentDistanceKm,
        base_fare: baseFare,
      };
      const { error: insErr } = await supabase.from('bookings').insert(payload);
      if (insErr) {
        const dup =
          insErr.code === '23505' ||
          /duplicate|unique/i.test(insErr.message ?? '');
        if (dup) {
          setExistingBooking(true);
          Alert.alert('Reserva', 'Ya tenés una reserva en este viaje.');
        } else {
          Alert.alert('Error', insErr.message ?? 'No se pudo reservar');
        }
        setSubmitting(false);
        return;
      }
      await saveExtraStops(
        rideId,
        extraStops.slice(0, 3).map((s, i) => ({
          lat: s.lat,
          lng: s.lng,
          label: s.label ?? null,
          order: i + 1,
        }))
      );
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            { name: 'MainTabs' },
            { name: 'RideDetail', params: { rideId } },
          ],
        })
      );
      Alert.alert('Listo', 'Reserva creada. Acá podés ver el detalle de tu reserva.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (error && !ride) {
  return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
        <Text style={styles.btnText}>Volver</Text>
      </TouchableOpacity>
    </View>
    );
  }

  if (!ride) return null;

  const driver = ride.driver as { full_name?: string; rating_average?: number; rating_count?: number } | null;
  const originLabel = String(ride.origin_label ?? 'Origen');
  const destLabel = String(ride.destination_label ?? 'Destino');
  const dep = ride.departure_time ? new Date(String(ride.departure_time)).toLocaleString('es-PY') : '';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.routeTitle}>
        {originLabel} → {destLabel}
      </Text>
      <Text style={styles.meta}>{dep}</Text>
      {driver ? (
        <View style={styles.driverBox}>
          <Text style={styles.driverName}>{driver.full_name ?? 'Conductor'}</Text>
          {driver.rating_average != null && (
            <Text style={styles.rating}>
              ★ {Number(driver.rating_average).toFixed(1)}
              {driver.rating_count ? ` · ${driver.rating_count} viajes` : ''}
            </Text>
          )}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {existingBooking ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>Ya tenés una reserva en este viaje.</Text>
          <TouchableOpacity onPress={() => navigation.navigate('RideDetail', { rideId })}>
            <Text style={styles.link}>Ver detalle del viaje</Text>
          </TouchableOpacity>
        </View>
      ) : maxSeats < 1 ? (
        <Text style={styles.muted}>No hay asientos disponibles.</Text>
      ) : (
        <>
          {(routeResolving || masterGreyResolving) && mapDisplayRoute.length < 2 ? (
            <ActivityIndicator style={{ marginVertical: 20 }} size="large" color="#166534" />
          ) : null}
          {mapDisplayRoute.length >= 2 ? (
            <>
              <Text style={styles.sectionTitle}>Tu tramo en la ruta</Text>
              {!usesDriverSeatPrice && !env.apiBaseUrl?.trim() ? (
                <Text style={styles.warnBoxText}>
                  Configurá EXPO_PUBLIC_API_BASE_URL para calcular el precio con OSRM.
                </Text>
              ) : null}
              {usesDriverSeatPrice ? (
                <Text style={styles.warnBoxText}>
                  Precio por asiento definido por el conductor: ₲ {fixedSeatPrice.toLocaleString('es-PY')}.
                </Text>
              ) : null}
              <PickupDropoffMapView
                baseRoute={mapDisplayRoute}
                resolvedPassengerRoute={mergedPassengerRoute}
                pickup={pickup}
                dropoff={dropoff}
                onPickupChange={setPickup}
                onDropoffChange={setDropoff}
                maxDeviationMeters={maxDeviationMeters}
                extraStops={extraStops}
                onExtraStopsChange={setExtraStops}
                maxExtraStops={3}
                driverStops={driverStops}
                existingPickups={existingPickups}
                existingDropoffs={existingDropoffs}
                height={340}
              />
            </>
          ) : (
            <Text style={styles.muted}>
              Este viaje no tiene polyline guardada; la reserva usará tarifa mínima por asiento según configuración.
            </Text>
          )}

          <Text style={styles.label}>Asientos</Text>
          <View style={styles.seatsStepper}>
            <TouchableOpacity
              style={[styles.seatStepHit, seats <= 1 && styles.seatStepHitDisabled]}
              onPress={() => setSeats((s) => Math.max(1, s - 1))}
              disabled={seats <= 1}
              accessibilityRole="button"
              accessibilityLabel="Menos un asiento"
            >
              <Text style={[styles.seatStepSymbol, seats <= 1 && styles.seatStepSymbolDisabled]}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.seatStepInput}
              value={String(seats)}
              onChangeText={(t) =>
                setSeats(Math.min(maxSeats, Math.max(1, parseInt(t.replace(/\D/g, ''), 10) || 1)))
              }
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel="Cantidad de asientos"
            />
            <TouchableOpacity
              style={[styles.seatStepHit, seats >= maxSeats && styles.seatStepHitDisabled]}
              onPress={() => setSeats((s) => Math.min(maxSeats, s + 1))}
              disabled={seats >= maxSeats}
              accessibilityRole="button"
              accessibilityLabel="Más un asiento"
            >
              <Text style={[styles.seatStepSymbol, seats >= maxSeats && styles.seatStepSymbolDisabled]}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hintSmall}>Disponibles: {maxSeats}</Text>

          {mapDisplayRoute.length >= 2 && (!pickup || !dropoff) ? (
            <Text style={styles.muted}>Marcá A y B para ver el precio del tramo.</Text>
          ) : !usesDriverSeatPrice && priceLoading ? (
            <Text style={styles.muted}>Calculando precio…</Text>
          ) : totalPrice != null ? (
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>Total estimado</Text>
              <Text style={styles.priceValue}>
                ₲ {totalPrice.toLocaleString('es-PY')}
                {!usesDriverSeatPrice && segmentDistanceKm != null ? ` · ~${segmentDistanceKm.toFixed(1)} km` : ''}
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>No se pudo calcular el tramo; se usará tarifa mínima al confirmar.</Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Confirmar reserva</Text>}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.secondaryBtnText}>Volver</Text>
      </TouchableOpacity>
      {Platform.OS === 'ios' ? <View style={{ height: 24 }} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  routeTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
  meta: { fontSize: 14, color: '#6b7280', marginTop: 4, marginBottom: 12 },
  driverBox: { backgroundColor: '#f9fafb', padding: 12, borderRadius: 10, marginBottom: 16 },
  driverName: { fontSize: 16, fontWeight: '600' },
  rating: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 8, color: '#374151' },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  seatsStepper: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  seatStepHit: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    minWidth: 52,
    backgroundColor: '#f0fdf4',
  },
  seatStepHitDisabled: {
    backgroundColor: '#f3f4f6',
  },
  seatStepSymbol: {
    fontSize: 24,
    fontWeight: '600',
    color: '#166534',
    lineHeight: 28,
  },
  seatStepSymbolDisabled: {
    color: '#9ca3af',
  },
  seatStepInput: {
    flex: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e5e7eb',
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    color: '#111827',
  },
  hintSmall: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  priceBox: { backgroundColor: '#ecfdf5', padding: 14, borderRadius: 10, marginTop: 16 },
  priceLabel: { fontSize: 13, color: '#065f46' },
  priceValue: { fontSize: 20, fontWeight: '800', color: '#166534', marginTop: 4 },
  muted: { fontSize: 14, color: '#6b7280', marginTop: 8 },
  errorText: { color: '#b91c1c', marginBottom: 12 },
  warnBox: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 12 },
  warnText: { color: '#92400e' },
  warnBoxText: { color: '#92400e', marginBottom: 8, fontSize: 13 },
  link: { color: '#166534', fontWeight: '600', marginTop: 8 },
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  secondaryBtnText: { color: '#6b7280', fontSize: 15 },
  btn: { marginTop: 16, backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
});
