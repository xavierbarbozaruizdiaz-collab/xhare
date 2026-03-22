/**
 * Crear "Tengo lugar" (driver_ride_availability). Origen, destino (geocode), fecha/hora salida, asientos, precio sugerido.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { searchAddresses } from '../backend/geocodeApi';
import type { GeocodeSuggestion } from '../backend/geocodeApi';
import { FlatList } from 'react-native';

export function OfferTengoNewScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [originLat, setOriginLat] = useState<number | null>(null);
  const [originLng, setOriginLng] = useState<number | null>(null);
  const [destinationLat, setDestinationLat] = useState<number | null>(null);
  const [destinationLng, setDestinationLng] = useState<number | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('08:00');
  const [availableSeats, setAvailableSeats] = useState(1);
  const [suggestedPrice, setSuggestedPrice] = useState('');
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

  const handleSubmit = useCallback(async () => {
    if (!session?.id || originLat == null || originLng == null || destinationLat == null || destinationLng == null || !departureDate) {
      Alert.alert('Faltan datos', 'Completá origen, destino y fecha de salida.');
      return;
    }
    const dep = new Date(`${departureDate}T${departureTime}:00`);
    if (dep <= new Date()) {
      Alert.alert('Fecha inválida', 'La salida debe ser futura.');
      return;
    }
    setSubmitting(true);
    const acceptUntil = new Date();
    acceptUntil.setHours(acceptUntil.getHours() + 24);
    const { data, error } = await supabase
      .from('driver_ride_availability')
      .insert({
        driver_id: session.id,
        origin_lat: originLat,
        origin_lng: originLng,
        origin_label: originLabel.slice(0, 500) || null,
        destination_lat: destinationLat,
        destination_lng: destinationLng,
        destination_label: destinationLabel.slice(0, 500) || null,
        departure_time: dep.toISOString(),
        available_seats: Math.max(1, Math.min(20, availableSeats)),
        suggested_price_per_seat: suggestedPrice.trim() ? parseInt(suggestedPrice.replace(/\D/g, ''), 10) || null : null,
        status: 'open',
        accept_offers_until: acceptUntil.toISOString(),
      })
      .select('id')
      .single();
    setSubmitting(false);
    if (error) {
      Alert.alert('Error', error.message || 'No se pudo publicar.');
      return;
    }
    Alert.alert('Listo', 'Tu publicación "Tengo lugar" fue creada.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  }, [session?.id, originLat, originLng, destinationLat, destinationLng, originLabel, destinationLabel, departureDate, departureTime, availableSeats, suggestedPrice, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
                <Text style={styles.suggestionText} numberOfLines={2}>{item.display_name}</Text>
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
                <Text style={styles.suggestionText} numberOfLines={2}>{item.display_name}</Text>
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
        </View>
      )}

      <Text style={styles.label}>Fecha de salida</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
        <Text style={departureDate ? styles.inputText : styles.inputPlaceholder}>{departureDate || 'Elegir fecha'}</Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          value={departureDate ? new Date(departureDate + 'T12:00:00') : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={new Date()}
          onChange={(_, d) => {
            setShowDatePicker(Platform.OS === 'ios');
            if (d) setDepartureDate(d.toISOString().slice(0, 10));
          }}
        />
      )}

      <Text style={styles.label}>Hora de salida</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowTimePicker(true)}>
        <Text style={styles.inputText}>{departureTime}</Text>
      </TouchableOpacity>
      {showTimePicker && (
        <DateTimePicker
          value={(() => {
            const [h, m] = departureTime.split(':').map(Number);
            const d = new Date();
            d.setHours(isNaN(h) ? 8 : h, isNaN(m) ? 0 : m, 0, 0);
            return d;
          })()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, d) => {
            setShowTimePicker(Platform.OS === 'ios');
            if (d) setDepartureTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
          }}
        />
      )}

      <Text style={styles.label}>Asientos disponibles</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => setAvailableSeats((s) => Math.max(1, s - 1))}>
          <Text style={styles.stepperText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{availableSeats}</Text>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => setAvailableSeats((s) => Math.min(20, s + 1))}>
          <Text style={styles.stepperText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Precio sugerido por asiento (Gs, opcional)</Text>
      <TextInput
        style={styles.input}
        value={suggestedPrice}
        onChangeText={setSuggestedPrice}
        placeholder="Ej. 25000"
        placeholderTextColor="#9ca3af"
        keyboardType="numeric"
      />

      <TouchableOpacity
        style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={submitting || !originLat || !destinationLat || !departureDate}
      >
        <Text style={styles.submitBtnText}>{submitting ? 'Publicando…' : 'Publicar lugar'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
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
  suggestions: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, marginTop: -8, marginBottom: 8, maxHeight: 140 },
  suggestionItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  suggestionText: { fontSize: 14, color: '#374151' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  stepperBtn: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  stepperText: { fontSize: 20, color: '#166534', fontWeight: '600' },
  stepperValue: { fontSize: 18, fontWeight: '600', minWidth: 40, textAlign: 'center' },
  submitBtn: { backgroundColor: '#166534', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
