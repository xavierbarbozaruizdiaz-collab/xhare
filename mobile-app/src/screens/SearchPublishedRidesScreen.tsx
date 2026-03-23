/**
 * Lista viajes publicados (búsqueda simple por fecha).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { searchRides } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'SearchPublishedRides'>;

export function SearchPublishedRidesScreen() {
  const navigation = useNavigation<Nav>();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  /** HH:MM opcional; solo aplica si hay fecha válida. */
  const [fromTime, setFromTime] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Record<string, unknown>[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await searchRides({
        date: date.trim() || undefined,
        fromTimeLocal: date.trim() && fromTime.trim() ? fromTime.trim() : undefined,
        origin: origin.trim() || undefined,
        destination: destination.trim() || undefined,
        seats: 1,
      });
      setList(rows as Record<string, unknown>[]);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [date, fromTime, origin, destination]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Fecha</Text>
      <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      <Text style={styles.label}>Hora desde (opcional, HH:MM)</Text>
      <TextInput
        style={styles.input}
        value={fromTime}
        onChangeText={setFromTime}
        placeholder="Ej. 14:30 — vacío = todo el día"
        placeholderTextColor="#9ca3af"
      />
      <Text style={styles.label}>Origen (texto)</Text>
      <TextInput style={styles.input} value={origin} onChangeText={setOrigin} placeholder="Opcional" />
      <Text style={styles.label}>Destino (texto)</Text>
      <TextInput style={styles.input} value={destination} onChangeText={setDestination} placeholder="Opcional" />
      <TouchableOpacity style={styles.searchBtn} onPress={load}>
        <Text style={styles.searchBtnText}>Buscar</Text>
      </TouchableOpacity>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} size="large" color="#166534" />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No hay viajes para esos filtros.</Text>}
          renderItem={({ item }) => {
            const dep = item.departure_time ? new Date(String(item.departure_time)).toLocaleString('es-PY') : '';
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate('RideDetail', { rideId: String(item.id) })}
              >
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {String(item.origin_label ?? '')} → {String(item.destination_label ?? '')}
                </Text>
                <Text style={styles.cardMeta}>{dep}</Text>
                <Text style={styles.cardMeta}>Cupos: {String(item.available_seats ?? '—')}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 16,
  },
  searchBtn: { backgroundColor: '#166534', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  list: { paddingTop: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#f9fafb',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  cardMeta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 24 },
});
