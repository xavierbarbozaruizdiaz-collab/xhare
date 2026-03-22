/**
 * Pasajero: reservar sobre la ruta publicada (mapa A/B + hasta 3 paradas, snap, OSRM → precio por tramo).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { fetchSegmentStats } from '../backend/routeApi';
import { reverseGeocodeStructured } from '../backend/geocodeApi';
import { saveExtraStops } from '../backend/api';
import { fetchRideForReserve } from '../rides/api';
import { PickupDropoffMapView, type MapPoint, type ExtraStopPoint, type DriverStopMarker } from '../components/PickupDropoffMapView';
import { buildPolylineFromRide, getPositionAlongPolyline, type Point } from '../lib/geo';
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

type Nav = NativeStackNavigationProp<MainStackParamList, 'BookRide'>;
type ScreenRoute = RouteProp<MainStackParamList, 'BookRide'>;

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

  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;

  const basePolyline = useMemo(() => (ride ? buildPolylineFromRide(ride as Parameters<typeof buildPolylineFromRide>[0]) : []), [ride]);

  const maxDeviationMeters = useMemo(() => {
    const km = ride ? Number((ride as { max_deviation_km?: number }).max_deviation_km ?? 1) : 1;
    return Math.max(200, km * 1000);
  }, [ride]);

  const maxSeats = Math.max(0, Number(ride?.available_seats ?? 0));

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
      const others = bks.filter((b: { passenger_id: string }) => b.passenger_id !== session.id);
      setExistingPickups(
        others
          .filter((b: Record<string, unknown>) => b.pickup_lat != null && b.pickup_lng != null)
          .map((b: Record<string, unknown>) => ({
            lat: Number(b.pickup_lat),
            lng: Number(b.pickup_lng),
            label: (b.pickup_label as string | null) ?? null,
          }))
      );
      setExistingDropoffs(
        others
          .filter((b: Record<string, unknown>) => b.dropoff_lat != null && b.dropoff_lng != null)
          .map((b: Record<string, unknown>) => ({
            lat: Number(b.dropoff_lat),
            lng: Number(b.dropoff_lng),
            label: (b.dropoff_label as string | null) ?? null,
          }))
      );

      const mine = bks.find((b: { passenger_id: string }) => b.passenger_id === session.id);
      setExistingBooking(!!mine);

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
      setExistingPickups((prev) => [...prev, ...trPickups]);
      setExistingDropoffs((prev) => [...prev, ...trDropoffs]);

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
    if (!pickup || !dropoff || !env.apiBaseUrl?.trim()) {
      setSegmentDistanceKm(null);
      return;
    }
    let cancelled = false;
    setPriceLoading(true);
    const via =
      basePolyline.length >= 2
        ? sortExtrasBetween(pickup, dropoff, extraStops, basePolyline)
        : [];
    fetchSegmentStats(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: dropoff.lat, lng: dropoff.lng },
      via
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
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, extraStops, basePolyline]);

  const totalPrice =
    segmentBaseFare != null
      ? totalFareFromBaseAndSeatsWithPricing(segmentBaseFare, Math.min(maxSeats, Math.max(1, seats)), effectivePricing)
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
    if (basePolyline.length >= 2 && (!pickup || !dropoff)) {
      Alert.alert('Mapa', 'Marcá subida (A) y bajada (B) en la ruta.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const seatsToBook = Math.min(maxSeats, Math.max(1, seats));
      const baseFare = segmentBaseFare ?? effectivePricing.minFarePyg;
      const pricePaid = totalFareFromBaseAndSeatsWithPricing(baseFare, seatsToBook, effectivePricing);
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
        segment_distance_km: segmentDistanceKm ?? undefined,
        base_fare: baseFare,
        seats: seatsToBook,
        total: pricePaid,
      };
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
        selected_seat_ids: null,
        pricing_snapshot: pricingSnapshot,
        pricing_settings_id: effectivePricing.pricingSettingsId,
        segment_distance_km: segmentDistanceKm,
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
      Alert.alert('Listo', 'Reserva creada.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
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
          <TouchableOpacity onPress={() => parentNav?.navigate('RideDetail', { rideId })}>
            <Text style={styles.link}>Ver detalle del viaje</Text>
          </TouchableOpacity>
        </View>
      ) : maxSeats < 1 ? (
        <Text style={styles.muted}>No hay asientos disponibles.</Text>
      ) : (
        <>
          {basePolyline.length >= 2 ? (
            <>
              <Text style={styles.sectionTitle}>Tu tramo en la ruta</Text>
              {!env.apiBaseUrl?.trim() ? (
                <Text style={styles.warnBoxText}>
                  Configurá EXPO_PUBLIC_API_BASE_URL para calcular el precio con OSRM.
                </Text>
              ) : null}
              <PickupDropoffMapView
                baseRoute={basePolyline}
                pickup={pickup}
                dropoff={dropoff}
                onPickupChange={setPickup}
                onDropoffChange={setDropoff}
                maxDeviationMeters={maxDeviationMeters}
                snapToRoute
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
          <TextInput
            style={styles.input}
            value={String(seats)}
            onChangeText={(t) => setSeats(Math.min(maxSeats, Math.max(1, parseInt(t.replace(/\D/g, ''), 10) || 1)))}
            keyboardType="number-pad"
          />
          <Text style={styles.hintSmall}>Disponibles: {maxSeats}</Text>

          {basePolyline.length >= 2 && (!pickup || !dropoff) ? (
            <Text style={styles.muted}>Marcá A y B para ver el precio del tramo.</Text>
          ) : priceLoading ? (
            <Text style={styles.muted}>Calculando precio…</Text>
          ) : totalPrice != null ? (
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>Total estimado</Text>
              <Text style={styles.priceValue}>
                ₲ {totalPrice.toLocaleString('es-PY')}
                {segmentDistanceKm != null ? ` · ~${segmentDistanceKm.toFixed(1)} km` : ''}
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
