/**
 * Guardar solicitud de trayecto (trip_requests): origen/destino, fecha, tipo interno vs larga distancia y precio/confirmación.
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlatList } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import {
  searchAddresses,
  reverseGeocodeStructured,
  type ReverseGeocodeResult,
} from '../backend/geocodeApi';
import { fetchRoute } from '../backend/routeApi';
import { raceWithTimeout } from '../backend/withTimeout';
import { clampDateNotBeforeLocalDay, datePickerDisplay, startOfLocalDay, timePickerDisplay, toYmdLocal } from '../lib/datePickerUi';
import { distanceMeters } from '../lib/geo';
import type { GeocodeSuggestion } from '../backend/geocodeApi';
import type { MainStackParamList } from '../navigation/types';
import { saveTripRequest } from '../rides/api';
import {
  loadActivePricingSettings,
  computeEffectivePricing,
  type EffectivePricing,
} from '../lib/pricing/runtime-pricing';
import {
  baseFareFromDistanceKmWithPricing,
  totalFareFromBaseAndSeatsWithPricing,
} from '../lib/pricing/segment-fare';
import { isPickupAtLeastLeadAhead } from '../lib/bookingLead';
import { Ionicons } from '@expo/vector-icons';
import { SearchOriginDestinationMap, type SearchRouteEtaState } from '../components/SearchOriginDestinationMap';
import type { Point } from '../lib/geo';
import { formatEstimatedArrivalLine } from '../lib/routeEtaFormat';

type Nav = NativeStackNavigationProp<MainStackParamList, 'SaveTripRequest'>;

type PricingKind = 'internal' | 'long_distance';
const FALLBACK_PRICING: EffectivePricing = {
  minFarePyg: 7140,
  pygPerKm: 2780,
  roundTo: 100,
  blockSize: 4,
  blockMultiplier: 1.5,
  driverFeePercentOfCollected: 10,
  pricingSettingsId: null,
};

const PRICING_LOAD_TIMEOUT_MS = 12_000;
/** No bloquear el guardado esperando Nominatim: tras esto se guarda sin ciudad/barrio extra. */
const GEOCODE_ENRICH_ON_SAVE_MS = 5500;

export function SaveTripRequestScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<MainStackParamList, 'SaveTripRequest'>>();
  const pre = route.params ?? {};
  const { session } = useAuth();
  const suggested = pre.suggestedPricingKind;

  const [originLabel, setOriginLabel] = useState(pre.originLabel ?? '');
  const [destinationLabel, setDestinationLabel] = useState(pre.destinationLabel ?? '');
  const [originLat, setOriginLat] = useState<number | null>(
    pre.originLat != null && Number.isFinite(pre.originLat) ? pre.originLat : null
  );
  const [originLng, setOriginLng] = useState<number | null>(
    pre.originLng != null && Number.isFinite(pre.originLng) ? pre.originLng : null
  );
  const [destinationLat, setDestinationLat] = useState<number | null>(
    pre.destinationLat != null && Number.isFinite(pre.destinationLat) ? pre.destinationLat : null
  );
  const [destinationLng, setDestinationLng] = useState<number | null>(
    pre.destinationLng != null && Number.isFinite(pre.destinationLng) ? pre.destinationLng : null
  );
  const [requestedDate, setRequestedDate] = useState(pre.requestedDate?.trim() ?? '');
  const [requestedTime, setRequestedTime] = useState(
    pre.requestedTime?.trim() && /^\d{1,2}:\d{2}$/.test(pre.requestedTime.trim())
      ? pre.requestedTime.trim()
      : '08:00'
  );
  const [seats, setSeats] = useState(1);
  const [pricingKind, setPricingKind] = useState<PricingKind>(
    suggested === 'long_distance' || suggested === 'internal' ? suggested : 'internal'
  );
  const [desiredPriceGs, setDesiredPriceGs] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [originSuggestions, setOriginSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [internalEstimateLoading, setInternalEstimateLoading] = useState(false);
  const [internalDistanceKm, setInternalDistanceKm] = useState<number | null>(null);
  const [internalPerSeatCost, setInternalPerSeatCost] = useState<number | null>(null);
  const [internalTotalCost, setInternalTotalCost] = useState<number | null>(null);
  /** true cuando la distancia viene del backend de ruta; false si es aproximación por recta. */
  const [internalDistanceFromRoute, setInternalDistanceFromRoute] = useState(true);
  const [tripMapExpanded, setTripMapExpanded] = useState(true);
  const [routeEta, setRouteEta] = useState<SearchRouteEtaState>({
    loading: false,
    durationMinutes: null,
    distanceKm: null,
    polyline: null,
  });
  const [passengerRouteNameHint, setPassengerRouteNameHint] = useState(
    typeof pre.passengerRouteNameHint === 'string' ? pre.passengerRouteNameHint : ''
  );

  const originGeo = useMemo<Point | null>(
    () =>
      originLat != null && originLng != null && Number.isFinite(originLat) && Number.isFinite(originLng)
        ? { lat: originLat, lng: originLng }
        : null,
    [originLat, originLng]
  );
  const destGeo = useMemo<Point | null>(
    () =>
      destinationLat != null &&
      destinationLng != null &&
      Number.isFinite(destinationLat) &&
      Number.isFinite(destinationLng)
        ? { lat: destinationLat, lng: destinationLng }
        : null,
    [destinationLat, destinationLng]
  );

  const setOriginGeo = useCallback((p: Point | null) => {
    setOriginLat(p?.lat ?? null);
    setOriginLng(p?.lng ?? null);
  }, []);
  const setDestGeo = useCallback((p: Point | null) => {
    setDestinationLat(p?.lat ?? null);
    setDestinationLng(p?.lng ?? null);
  }, []);

  const mapProximityRadiusKm = pricingKind === 'long_distance' ? 50 : 1;

  useEffect(() => {
    if (originLat != null && originLng != null) {
      setOriginSuggestions([]);
      setShowOriginSuggestions(false);
      return;
    }
    if (originLabel.length < 3) {
      setOriginSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      const list = await searchAddresses(originLabel, 5);
      setOriginSuggestions(list);
      setShowOriginSuggestions(list.length > 0);
    }, 400);
    return () => clearTimeout(t);
  }, [originLabel, originLat, originLng]);

  useEffect(() => {
    if (destinationLat != null && destinationLng != null) {
      setDestinationSuggestions([]);
      setShowDestinationSuggestions(false);
      return;
    }
    if (destinationLabel.length < 3) {
      setDestinationSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      const list = await searchAddresses(destinationLabel, 5);
      setDestinationSuggestions(list);
      setShowDestinationSuggestions(list.length > 0);
    }, 400);
    return () => clearTimeout(t);
  }, [destinationLabel, destinationLat, destinationLng]);

  const selectOrigin = useCallback((s: GeocodeSuggestion) => {
    setOriginLat(parseFloat(s.lat));
    setOriginLng(parseFloat(s.lon));
    setOriginLabel(s.display_name || '');
    setShowOriginSuggestions(false);
  }, []);

  const selectDestination = useCallback((s: GeocodeSuggestion) => {
    setDestinationLat(parseFloat(s.lat));
    setDestinationLng(parseFloat(s.lon));
    setDestinationLabel(s.display_name || '');
    setShowDestinationSuggestions(false);
  }, []);

  useEffect(() => {
    if (
      pricingKind !== 'internal' ||
      originLat == null ||
      originLng == null ||
      destinationLat == null ||
      destinationLng == null
    ) {
      setInternalDistanceKm(null);
      setInternalPerSeatCost(null);
      setInternalTotalCost(null);
      setInternalDistanceFromRoute(true);
      setInternalEstimateLoading(false);
      return;
    }
    let cancelled = false;
    setInternalEstimateLoading(true);
    void (async () => {
      try {
        const straightKm =
          distanceMeters(
            { lat: originLat, lng: originLng },
            { lat: destinationLat, lng: destinationLng }
          ) / 1000;
        const [routeRes, pricingRow] = await Promise.all([
          fetchRoute({ lat: originLat, lng: originLng }, { lat: destinationLat, lng: destinationLng }, []),
          raceWithTimeout(loadActivePricingSettings(), PRICING_LOAD_TIMEOUT_MS, () => null),
        ]);
        if (cancelled) return;
        const routeKm = Number(routeRes.distanceKm ?? 0);
        const fromRoute = Number.isFinite(routeKm) && routeKm > 0 && !routeRes.error;
        const distanceKm = fromRoute ? routeKm : straightKm * 1.2;
        if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
          setInternalDistanceKm(null);
          setInternalPerSeatCost(null);
          setInternalTotalCost(null);
          setInternalDistanceFromRoute(true);
          return;
        }
        const pricing = pricingRow ? computeEffectivePricing(pricingRow) : FALLBACK_PRICING;
        const baseFare = baseFareFromDistanceKmWithPricing(distanceKm, pricing);
        const totalFare = totalFareFromBaseAndSeatsWithPricing(baseFare, Math.max(1, seats), pricing);
        const perSeatRaw = totalFare / Math.max(1, seats);
        const perSeatRounded = Math.round(perSeatRaw / pricing.roundTo) * pricing.roundTo;
        setInternalDistanceKm(distanceKm);
        setInternalPerSeatCost(perSeatRounded);
        setInternalTotalCost(totalFare);
        setInternalDistanceFromRoute(fromRoute);
      } finally {
        if (!cancelled) setInternalEstimateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pricingKind, originLat, originLng, destinationLat, destinationLng, seats]);

  const hasValidCoords =
    originLat != null &&
    originLng != null &&
    destinationLat != null &&
    destinationLng != null &&
    Number.isFinite(originLat) &&
    Number.isFinite(originLng) &&
    Number.isFinite(destinationLat) &&
    Number.isFinite(destinationLng);

  const estimatedArrival = useMemo(
    () =>
      formatEstimatedArrivalLine(requestedDate, requestedTime, routeEta, hasValidCoords),
    [requestedDate, requestedTime, routeEta, hasValidCoords]
  );

  const submit = useCallback(async () => {
    if (!session?.id || !session.access_token) {
      Alert.alert('Sesión', 'Iniciá sesión.');
      return;
    }
    if (!hasValidCoords || !requestedDate.trim()) {
      Alert.alert('Datos', 'Elegí origen y destino en el mapa o desde las sugerencias.');
      return;
    }
    if (pricingKind === 'long_distance') {
      const n = parseInt(desiredPriceGs.replace(/\D/g, ''), 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Precio', 'Indicá precio por asiento.');
        return;
      }
    }

    const timeStr = /^\d{1,2}:\d{2}$/.test(requestedTime.trim()) ? requestedTime.trim() : '08:00';
    if (!isPickupAtLeastLeadAhead(requestedDate.trim(), timeStr)) {
      Alert.alert(
        'Anticipación mínima',
        'La fecha y hora de salida tienen que ser al menos 4 horas desde ahora (hora de este dispositivo).'
      );
      return;
    }

    setSubmitting(true);
    try {
      const oLab = (originLabel.trim() || 'Ubicación en mapa').slice(0, 500);
      const dLab = (destinationLabel.trim() || 'Ubicación en mapa').slice(0, 500);

      const [oRev, dRev] = await raceWithTimeout(
        Promise.all([
          reverseGeocodeStructured(originLat, originLng),
          reverseGeocodeStructured(destinationLat, destinationLng),
        ]),
        GEOCODE_ENRICH_ON_SAVE_MS,
        (): [ReverseGeocodeResult, ReverseGeocodeResult] => [
          { displayName: oLab, city: null, department: null, barrio: null },
          { displayName: dLab, city: null, department: null, barrio: null },
        ]
      );

      const desiredGs =
        pricingKind === 'long_distance'
          ? parseInt(desiredPriceGs.replace(/\D/g, ''), 10)
          : null;

      const res = await saveTripRequest({
        accessToken: session.access_token,
        userId: session.id,
        originLat,
        originLng,
        originLabel: oLab,
        destinationLat,
        destinationLng,
        destinationLabel: dLab,
        requestedDate: requestedDate.trim(),
        requestedTime: timeStr,
        seats: Math.max(1, Math.min(50, seats)),
        originCity: oRev.city,
        originDepartment: oRev.department,
        originBarrio: oRev.barrio,
        destinationCity: dRev.city,
        destinationDepartment: dRev.department,
        destinationBarrio: dRev.barrio,
        pricingKind,
        passengerDesiredPricePerSeatGs: desiredGs,
        internalQuoteAcknowledged: pricingKind === 'internal' ? true : null,
        routePolyline:
          routeEta.polyline && routeEta.polyline.length >= 2 ? routeEta.polyline : undefined,
        routeLengthKm:
          typeof routeEta.distanceKm === 'number' && Number.isFinite(routeEta.distanceKm)
            ? routeEta.distanceKm
            : undefined,
        passengerRouteNameHint: passengerRouteNameHint.trim() || undefined,
      });

      if (!res.ok) {
        Alert.alert('Error', res.error ?? 'No se pudo guardar.');
        return;
      }
      Alert.alert('Listo', 'Solicitud guardada.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Reintentá.');
    } finally {
      setSubmitting(false);
    }
  }, [
    session?.id,
    session?.access_token,
    hasValidCoords,
    originLat,
    originLng,
    destinationLat,
    destinationLng,
    originLabel,
    destinationLabel,
    requestedDate,
    requestedTime,
    seats,
    pricingKind,
    desiredPriceGs,
    navigation,
    routeEta.polyline,
    routeEta.distanceKm,
    passengerRouteNameHint,
  ]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Si no hay viajes publicados que coincidan, guardá tu trayecto acá. Elegí si es interno (ya cotizado) o larga
        distancia (precio que querés pagar por asiento, negociable con el conductor).
      </Text>

      <View style={styles.mapCollapsibleHeader}>
        <View style={styles.mapCollapsibleHeaderText}>
          <Text style={styles.mapCollapsibleTitle}>Mapa</Text>
          <Text style={styles.mapCollapsibleHint}>
            {tripMapExpanded
              ? 'Marcá origen y destino en el mapa, o usá los campos de abajo con sugerencias.'
              : 'Mostrá el mapa para ajustar puntos o ver la ruta.'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.mapToggleBtn}
          onPress={() => setTripMapExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={tripMapExpanded ? 'Ocultar mapa' : 'Mostrar mapa'}
        >
          <Ionicons
            name={tripMapExpanded ? 'chevron-up-outline' : 'map-outline'}
            size={tripMapExpanded ? 26 : 22}
            color="#14532d"
          />
        </TouchableOpacity>
      </View>
      {tripMapExpanded ? (
        <SearchOriginDestinationMap
          origin={originGeo}
          destination={destGeo}
          onOriginChange={setOriginGeo}
          onDestinationChange={setDestGeo}
          onOriginLabelResolved={setOriginLabel}
          onDestinationLabelResolved={setDestinationLabel}
          onRouteEtaChange={setRouteEta}
          proximityRadiusKm={mapProximityRadiusKm}
          height={240}
        />
      ) : null}

      <Text style={styles.label}>Origen</Text>
      <TextInput
        style={styles.input}
        value={originLabel}
        onChangeText={(t) => {
          setOriginLabel(t);
          setOriginLat(null);
          setOriginLng(null);
        }}
        placeholder="Dirección o lugar"
        placeholderTextColor="#9ca3af"
      />
      {showOriginSuggestions && originSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          <FlatList
            data={originSuggestions}
            keyExtractor={(item) => String(item.place_id ?? item.lat + item.lon)}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.suggestionItem} onPress={() => selectOrigin(item)}>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {item.display_name}
                </Text>
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
        </View>
      )}

      <Text style={styles.label}>Destino</Text>
      <TextInput
        style={styles.input}
        value={destinationLabel}
        onChangeText={(t) => {
          setDestinationLabel(t);
          setDestinationLat(null);
          setDestinationLng(null);
        }}
        placeholder="Dirección o lugar"
        placeholderTextColor="#9ca3af"
      />
      {showDestinationSuggestions && destinationSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          <FlatList
            data={destinationSuggestions}
            keyExtractor={(item) => String(item.place_id ?? item.lat + item.lon)}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.suggestionItem} onPress={() => selectDestination(item)}>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {item.display_name}
                </Text>
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
        </View>
      )}

      <Text style={styles.label}>Fecha</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
        <Text style={requestedDate ? styles.inputText : styles.inputPlaceholder}>
          {requestedDate || 'Elegir fecha'}
        </Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          value={
            requestedDate
              ? new Date(requestedDate + 'T12:00:00')
              : (() => {
                  const t = startOfLocalDay();
                  t.setHours(12, 0, 0, 0);
                  return t;
                })()
          }
          mode="date"
          display={datePickerDisplay()}
          minimumDate={startOfLocalDay()}
          onChange={(_, d) => {
            setShowDatePicker(Platform.OS === 'ios');
            if (d) {
              const clamped = clampDateNotBeforeLocalDay(d, new Date());
              setRequestedDate(toYmdLocal(clamped));
            }
          }}
        />
      )}

      <Text style={styles.label}>Hora aprox.</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowTimePicker(true)}>
        <Text style={styles.inputText}>{requestedTime}</Text>
      </TouchableOpacity>
      {showTimePicker && (
        <DateTimePicker
          value={(() => {
            const [h, m] = requestedTime.split(':').map(Number);
            const d = new Date();
            d.setHours(isNaN(h) ? 8 : h, isNaN(m) ? 0 : m, 0, 0);
            return d;
          })()}
          mode="time"
          display={timePickerDisplay()}
          onChange={(_, d) => {
            setShowTimePicker(Platform.OS === 'ios');
            if (d) {
              setRequestedTime(
                `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
              );
            }
          }}
        />
      )}

      <Text style={styles.label}>Llegada estimada en destino</Text>
      <View style={styles.estimateRow} accessibilityRole="text">
        <Text
          style={estimatedArrival.isPlaceholder ? styles.estimatePlaceholder : styles.estimateValue}
          selectable
        >
          {estimatedArrival.text}
        </Text>
      </View>

      <Text style={styles.label}>Nombre del viaje (opcional)</Text>
      <TextInput
        style={styles.input}
        value={passengerRouteNameHint}
        onChangeText={setPassengerRouteNameHint}
        placeholder="Si el conductor lo definió al publicar"
        placeholderTextColor="#9ca3af"
        maxLength={200}
      />

      <Text style={styles.label}>Asientos</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => setSeats((s) => Math.max(1, s - 1))}>
          <Text style={styles.stepperText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{seats}</Text>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => setSeats((s) => Math.min(20, s + 1))}>
          <Text style={styles.stepperText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Tipo de solicitud</Text>
      <View style={styles.kindRow}>
        <TouchableOpacity
          style={[styles.kindChip, pricingKind === 'internal' && styles.kindChipActive]}
          onPress={() => setPricingKind('internal')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, pricingKind === 'internal' && styles.kindChipTextActive]}>
            Viajes disponibles
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, pricingKind === 'long_distance' && styles.kindChipActive]}
          onPress={() => setPricingKind('long_distance')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, pricingKind === 'long_distance' && styles.kindChipTextActive]}>
            Ofertas de viajes
          </Text>
        </TouchableOpacity>
      </View>

      {pricingKind === 'internal' ? (
        <View style={styles.internalBox}>
          <Text style={styles.hint}>
            Viaje interno: el precio lo define la cotización que ya recibiste (plataforma o conductor). No usamos este
            dato para negociar acá.
          </Text>
          {internalEstimateLoading ? (
            <Text style={styles.internalEstimate}>( calculando costo estimado)</Text>
          ) : internalPerSeatCost != null ? (
            <>
              <Text style={styles.internalEstimate}>
                Costo estimado por asiento: {internalPerSeatCost.toLocaleString('es-PY')} Gs
              </Text>
              {internalTotalCost != null && (
                <Text style={styles.internalEstimateMuted}>
                  Total estimado ({seats} asiento{seats > 1 ? 's' : ''}): {internalTotalCost.toLocaleString('es-PY')} Gs
                  {internalDistanceKm != null
                    ? ` · Distancia estimada: ${internalDistanceKm.toFixed(1)} km${
                        internalDistanceFromRoute ? '' : ' (aprox., línea recta)'
                      }`
                    : ''}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.internalEstimateMuted}>
              Seleccioná origen y destino válidos para ver el costo estimado por asiento.
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.internalBox}>
          <Text style={styles.hint}>
            Ofertas de viajes: indicá cuánto querés pagar por asiento. El precio final lo podés acordar con el conductor
            (por ejemplo por chat).
          </Text>
          <Text style={styles.label}>Precio que querés pagar por asiento (Gs)</Text>
          <TextInput
            style={styles.input}
            value={desiredPriceGs}
            onChangeText={setDesiredPriceGs}
            placeholder="Ej. 25000"
            placeholderTextColor="#9ca3af"
            keyboardType="numeric"
          />
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
        onPress={() => void submit()}
        disabled={submitting || !hasValidCoords || !requestedDate.trim()}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>Guardar solicitud</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#4b5563', marginBottom: 16, lineHeight: 20 },
  mapCollapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingVertical: 4,
  },
  mapCollapsibleHeaderText: { flex: 1, minWidth: 0 },
  mapCollapsibleTitle: { fontSize: 16, fontWeight: '800', color: '#14532d', marginBottom: 4 },
  mapCollapsibleHint: { fontSize: 13, color: '#6b7280', lineHeight: 19 },
  mapToggleBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    alignItems: 'center',
    justifyContent: 'center',
  },
  estimateRow: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
    backgroundColor: '#f9fafb',
  },
  estimateValue: { fontSize: 15, color: '#111827', lineHeight: 22 },
  estimatePlaceholder: { fontSize: 14, color: '#9ca3af', lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  hint: { fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
    color: '#111',
  },
  inputText: { color: '#111' },
  inputPlaceholder: { color: '#9ca3af' },
  suggestions: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    marginTop: -8,
    marginBottom: 8,
    maxHeight: 140,
  },
  suggestionItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  suggestionText: { fontSize: 14, color: '#374151' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { fontSize: 20, color: '#166534', fontWeight: '600' },
  stepperValue: { fontSize: 18, fontWeight: '600', minWidth: 40, textAlign: 'center' },
  kindRow: { flexDirection: 'row', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  kindChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  kindChipActive: { backgroundColor: '#166534', borderColor: '#166534' },
  kindChipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  kindChipTextActive: { color: '#fff' },
  internalBox: { marginBottom: 16 },
  internalEstimate: { fontSize: 14, color: '#14532d', fontWeight: '700', marginBottom: 6 },
  internalEstimateMuted: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  submitBtn: { backgroundColor: '#166534', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
