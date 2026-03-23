/**
 * Guardar solicitud de trayecto (trip_requests): origen/destino, fecha, tipo interno vs larga distancia y precio/confirmación.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
  Switch,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlatList } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { searchAddresses, reverseGeocodeStructured } from '../backend/geocodeApi';
import type { GeocodeSuggestion } from '../backend/geocodeApi';
import type { MainStackParamList } from '../navigation/types';
import { saveTripRequest } from '../rides/api';

type Nav = NativeStackNavigationProp<MainStackParamList, 'SaveTripRequest'>;

type PricingKind = 'internal' | 'long_distance';

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
  const [internalAck, setInternalAck] = useState(false);
  const [desiredPriceGs, setDesiredPriceGs] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [originSuggestions, setOriginSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
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
  }, [originLabel]);

  useEffect(() => {
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
  }, [destinationLabel]);

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

  const submit = useCallback(async () => {
    if (!session?.id) {
      Alert.alert('Sesión', 'Iniciá sesión para guardar la solicitud.');
      return;
    }
    if (originLat == null || originLng == null || destinationLat == null || destinationLng == null || !requestedDate.trim()) {
      Alert.alert('Faltan datos', 'Completá origen, destino y fecha (elegí direcciones de la lista si faltan coordenadas).');
      return;
    }
    if (pricingKind === 'internal' && !internalAck) {
      Alert.alert(
        'Confirmación',
        'Para viaje interno tenés que confirmar que ya recibiste la cotización del costo.'
      );
      return;
    }
    if (pricingKind === 'long_distance') {
      const n = parseInt(desiredPriceGs.replace(/\D/g, ''), 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Precio', 'Indicá cuánto querés pagar por asiento (en guaraníes).');
        return;
      }
    }

    setSubmitting(true);
    try {
      const timeStr = /^\d{1,2}:\d{2}$/.test(requestedTime.trim()) ? requestedTime.trim() : '08:00';
      const oLab = (originLabel.trim() || 'Ubicación en mapa').slice(0, 500);
      const dLab = (destinationLabel.trim() || 'Ubicación en mapa').slice(0, 500);

      const [oRev, dRev] = await Promise.all([
        reverseGeocodeStructured(originLat, originLng),
        reverseGeocodeStructured(destinationLat, destinationLng),
      ]);

      const desiredGs =
        pricingKind === 'long_distance'
          ? parseInt(desiredPriceGs.replace(/\D/g, ''), 10)
          : null;

      const res = await saveTripRequest({
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
      });

      if (!res.ok) {
        Alert.alert('Error', res.error ?? 'No se pudo guardar la solicitud.');
        return;
      }
      Alert.alert('Listo', 'Tu solicitud quedó guardada. Los conductores pueden verla y publicar un viaje.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setSubmitting(false);
    }
  }, [
    session?.id,
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
    internalAck,
    desiredPriceGs,
    navigation,
  ]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Si no hay viajes publicados que coincidan, guardá tu trayecto acá. Elegí si es interno (ya cotizado) o larga
        distancia (precio que querés pagar por asiento, negociable con el conductor).
      </Text>

      <Text style={styles.label}>Origen</Text>
      <TextInput
        style={styles.input}
        value={originLabel}
        onChangeText={setOriginLabel}
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
        onChangeText={setDestinationLabel}
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
          value={requestedDate ? new Date(requestedDate + 'T12:00:00') : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={new Date()}
          onChange={(_, d) => {
            setShowDatePicker(Platform.OS === 'ios');
            if (d) setRequestedDate(d.toISOString().slice(0, 10));
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
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
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
          <Text style={[styles.kindChipText, pricingKind === 'internal' && styles.kindChipTextActive]}>Interno</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, pricingKind === 'long_distance' && styles.kindChipActive]}
          onPress={() => setPricingKind('long_distance')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, pricingKind === 'long_distance' && styles.kindChipTextActive]}>
            Larga distancia
          </Text>
        </TouchableOpacity>
      </View>

      {pricingKind === 'internal' ? (
        <View style={styles.internalBox}>
          <Text style={styles.hint}>
            Viaje interno: el precio lo define la cotización que ya recibiste (plataforma o conductor). No usamos este
            dato para negociar acá.
          </Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Ya recibí la cotización del costo</Text>
            <Switch value={internalAck} onValueChange={setInternalAck} trackColor={{ true: '#86efac' }} />
          </View>
        </View>
      ) : (
        <View style={styles.internalBox}>
          <Text style={styles.hint}>
            Larga distancia: indicá cuánto querés pagar por asiento. El precio final lo podés acordar con el conductor
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
        disabled={submitting || !originLat || !destinationLat || !requestedDate}
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  switchLabel: { flex: 1, fontSize: 15, color: '#111', fontWeight: '500' },
  submitBtn: { backgroundColor: '#166534', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
