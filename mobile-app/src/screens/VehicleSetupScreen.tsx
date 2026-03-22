/**
 * Configuración de vehículo del conductor: modelo, año, cantidad de asientos.
 * Actualiza profiles.vehicle_model, vehicle_year, vehicle_seat_count.
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'VehicleSetup'>;

const SEAT_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function VehicleSetupScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [seatCount, setSeatCount] = useState(6);

  const load = useCallback(async () => {
    if (!session?.id) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('vehicle_model, vehicle_year, vehicle_seat_count')
        .eq('id', session.id)
        .maybeSingle();
      if (error && error.code !== '42703') {
        setLoading(false);
        return;
      }
      if (data) {
        setVehicleModel(String(data.vehicle_model ?? '').trim());
        setVehicleYear(data.vehicle_year != null ? String(data.vehicle_year) : '');
        setSeatCount(Math.max(6, Math.min(15, Number(data.vehicle_seat_count ?? 6))));
      }
    } finally {
      setLoading(false);
    }
  }, [session?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!session?.id) return;
    setSubmitting(true);
    try {
      const yearNum = vehicleYear.trim() ? parseInt(vehicleYear.replace(/\D/g, '').slice(0, 4), 10) : null;
      const { error } = await supabase
        .from('profiles')
        .update({
          vehicle_model: vehicleModel.trim() || null,
          vehicle_year: Number.isNaN(yearNum as number) ? null : yearNum,
          vehicle_seat_count: seatCount,
        })
        .eq('id', session.id);
      if (error) throw error;
      Alert.alert('Guardado', 'Datos del vehículo actualizados.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSubmitting(false);
    }
  }, [session?.id, vehicleModel, vehicleYear, seatCount, navigation]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Configuración de conductor</Text>
      <Text style={styles.intro}>Indicá el vehículo que usás y cuántos asientos tenés disponibles.</Text>

      <Text style={styles.label}>Vehículo (modelo o nombre)</Text>
      <TextInput
        style={styles.input}
        value={vehicleModel}
        onChangeText={setVehicleModel}
        placeholder="Ej. Hyundai County, Mercedes Sprinter"
        placeholderTextColor="#9ca3af"
        accessibilityLabel="Modelo del vehículo"
      />

      <Text style={styles.label}>Año (opcional)</Text>
      <TextInput
        style={styles.input}
        value={vehicleYear}
        onChangeText={(t) => setVehicleYear(t.replace(/\D/g, '').slice(0, 4))}
        placeholder="Ej. 2022"
        placeholderTextColor="#9ca3af"
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Cantidad de asientos</Text>
      <View style={styles.seatRow}>
        {SEAT_OPTIONS.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.seatBtn, seatCount === n && styles.seatBtnActive]}
            onPress={() => setSeatCount(n)}
          >
            <Text style={[styles.seatBtnText, seatCount === n && styles.seatBtnTextActive]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={submitting}
        accessibilityLabel="Guardar datos del vehículo"
        accessibilityRole="button"
      >
        <Text style={styles.saveBtnText}>{submitting ? 'Guardando…' : 'Guardar'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => navigation.goBack()}
        accessibilityLabel="Omitir por ahora"
        accessibilityRole="button"
      >
        <Text style={styles.skipBtnText}>Omitir por ahora</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 8 },
  intro: { fontSize: 14, color: '#6b7280', marginBottom: 20 },
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
  seatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  seatBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatBtnActive: { backgroundColor: '#166534', borderColor: '#166534' },
  seatBtnText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  seatBtnTextActive: { color: '#fff' },
  saveBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skipBtn: { marginTop: 16, alignItems: 'center' },
  skipBtnText: { color: '#666', fontSize: 15 },
});
