/**
 * Edit ride (driver): departure date, time, estimated duration.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import type { MainStackParamList } from '../navigation/types';

type Route = RouteProp<MainStackParamList, 'EditRide'>;
type Nav = NativeStackNavigationProp<MainStackParamList, 'EditRide'>;

export function EditRideScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const { rideId } = route.params;
  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!session?.id) return;
      const { data, error: e } = await supabase
        .from('rides')
        .select('id, driver_id, departure_time, estimated_duration_minutes')
        .eq('id', rideId)
        .single();
      if (e || !data) {
        setLoading(false);
        return;
      }
      if (data.driver_id !== session.id) {
        setLoading(false);
        return;
      }
      setRide(data as Record<string, unknown>);
      const d = data.departure_time ? new Date(data.departure_time as string) : new Date();
      setDepartureDate(d.toISOString().slice(0, 10));
      setDepartureTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      setDurationMin(Math.max(15, Math.min(1440, Number(data.estimated_duration_minutes ?? 60))));
      setLoading(false);
    })();
  }, [rideId, session?.id]);

  const handleSave = async () => {
    if (!session?.id || !ride) return;
    const dt = new Date(`${departureDate}T${departureTime}`);
    if (Number.isNaN(dt.getTime())) {
      setError('Fecha u hora inválida.');
      return;
    }
    if (dt <= new Date()) {
      setError('La fecha y hora deben ser futuras.');
      return;
    }
    const dur = Math.max(15, Math.min(1440, durationMin));
    setSubmitting(true);
    setError(null);
    const newStart = dt.getTime();
    const newEnd = newStart + dur * 60 * 1000;
    const { data: existing } = await supabase
      .from('rides')
      .select('id, departure_time, estimated_duration_minutes')
      .eq('driver_id', session.id)
      .in('status', ['published', 'booked', 'en_route', 'draft']);
    for (const r of existing ?? []) {
      if (r.id === rideId) continue;
      const start = new Date(r.departure_time as string).getTime();
      const d = (r.estimated_duration_minutes ?? 60) * 60 * 1000;
      if (newStart < start + d && newEnd > start) {
        setError('Ya tenés otro viaje en ese horario.');
        setSubmitting(false);
        return;
      }
    }
    const { error: err } = await supabase
      .from('rides')
      .update({
        departure_time: dt.toISOString(),
        estimated_duration_minutes: dur,
      })
      .eq('id', rideId)
      .eq('driver_id', session.id);
    setSubmitting(false);
    if (err) {
      setError(err.message ?? 'No se pudo actualizar.');
      return;
    }
    Alert.alert('Listo', 'Viaje actualizado.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
  };

  if (loading && !ride) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Viaje no encontrado</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Fecha salida</Text>
      <TextInput
        style={styles.input}
        value={departureDate}
        onChangeText={setDepartureDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#9ca3af"
      />
      <Text style={styles.label}>Hora salida</Text>
      <TextInput
        style={styles.input}
        value={departureTime}
        onChangeText={setDepartureTime}
        placeholder="HH:MM"
        placeholderTextColor="#9ca3af"
      />
      <Text style={styles.label}>Duración estimada (minutos)</Text>
      <TextInput
        style={styles.input}
        value={String(durationMin)}
        onChangeText={(t) => setDurationMin(parseInt(t.replace(/\D/g, ''), 10) || 60)}
        placeholder="60"
        placeholderTextColor="#9ca3af"
        keyboardType="number-pad"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Guardar</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelBtnText}>Cancelar</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
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
  errorText: { color: '#b91c1c', marginBottom: 12 },
  button: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { marginTop: 16, alignItems: 'center' },
  cancelBtnText: { color: '#666', fontSize: 15 },
  link: { color: '#166534', marginTop: 12 },
});
