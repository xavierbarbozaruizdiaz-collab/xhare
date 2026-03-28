/**
 * Pasajero: viajes publicados con cupos para un día (fecha editable, hora desde opcional).
 * Filtros completos → Buscar viajes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { searchRides } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';
import { isEnvConfigured } from '../backend/supabase';

type Nav = NativeStackNavigationProp<MainStackParamList, 'AvailableRides'>;

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function AvailableRidesScreen() {
  const navigation = useNavigation<Nav>();
  const [dateYmd, setDateYmd] = useState('');
  /** Vacío = sin filtro por hora (todo el día). */
  const [fromTimeHm, setFromTimeHm] = useState('');
  const [rideKind, setRideKind] = useState<'all' | 'internal' | 'long_distance'>('all');
  /** Filtro por nombre de ruta (`rides.route_name`), mismo criterio flexible que en Buscar viajes. */
  const [routeNameFilter, setRouteNameFilter] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [list, setList] = useState<Record<string, unknown>[]>([]);

  const timeLabel = fromTimeHm.trim() ? `desde las ${fromTimeHm.trim()}` : 'cualquier hora';

  const fetchRows = useCallback(async (): Promise<Record<string, unknown>[]> => {
    if (!isEnvConfigured()) return [];
    const rows = (await searchRides({
      date: dateYmd.trim(),
      fromTimeLocal: fromTimeHm.trim() || undefined,
      routeName: routeNameFilter.trim() || undefined,
      seats: 1,
    })) as Record<string, unknown>[];
    if (rideKind === 'all') return rows;
    return rows.filter((r) => {
      const hasDriverSeatPrice = Number(r.price_per_seat ?? 0) > 0;
      return rideKind === 'long_distance' ? hasDriverSeatPrice : !hasDriverSeatPrice;
    });
  }, [dateYmd, fromTimeHm, rideKind, routeNameFilter]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      void (async () => {
        try {
          const rows = await fetchRows();
          if (alive) setList(rows);
        } catch {
          if (alive) setList([]);
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [fetchRows])
  );

  /** Misma query cuando cambian filtros (ej. nombre) estando ya en la pantalla. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchRows();
        if (!cancelled) setList(rows);
      } catch {
        if (!cancelled) setList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRows]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    void (async () => {
      try {
        const rows = await fetchRows();
        setList(rows);
      } catch {
        setList([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })();
  }, [fetchRows]);

  const header = (
    <View style={styles.headerBlock}>
      <Text style={styles.fieldLabel}>Fecha</Text>
      <TouchableOpacity style={styles.pickerRow} onPress={() => setShowDatePicker(true)} accessibilityRole="button">
        <Text style={dateYmd.trim() ? styles.pickerValue : styles.pickerPlaceholder}>
          {dateYmd.trim() ? dateYmd : 'Sin filtro — mostrar todos los próximos viajes'}
        </Text>
      </TouchableOpacity>
      {dateYmd.trim() ? (
        <TouchableOpacity
          onPress={() => {
            setDateYmd('');
            setFromTimeHm('');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.clearTime}>Quitar fecha (ver próximos viajes)</Text>
        </TouchableOpacity>
      ) : null}
      {showDatePicker ? (
        <DateTimePicker
          value={dateYmd.trim() ? new Date(dateYmd + 'T12:00:00') : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(ev, d) => {
            if (ev.type === 'dismissed') {
              setShowDatePicker(false);
              return;
            }
            if (Platform.OS !== 'ios') setShowDatePicker(false);
            if (d) setDateYmd(toYmdLocal(d));
          }}
        />
      ) : null}

      <Text style={styles.fieldLabel}>Hora desde (opcional)</Text>
      <TouchableOpacity style={styles.pickerRow} onPress={() => setShowTimePicker(true)} accessibilityRole="button">
        <Text style={fromTimeHm.trim() ? styles.pickerValue : styles.pickerPlaceholder}>
          {fromTimeHm.trim() ? fromTimeHm.trim() : 'Todo el día — tocá para elegir hora'}
        </Text>
      </TouchableOpacity>
      {fromTimeHm.trim() ? (
        <TouchableOpacity onPress={() => setFromTimeHm('')} accessibilityRole="button">
          <Text style={styles.clearTime}>Quitar hora (ver todo el día)</Text>
        </TouchableOpacity>
      ) : null}
      {showTimePicker ? (
        <DateTimePicker
          value={(() => {
            const [h, m] = fromTimeHm.split(':').map((x) => parseInt(x, 10));
            const d = new Date();
            d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);
            return d;
          })()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(ev, d) => {
            if (ev.type === 'dismissed') {
              setShowTimePicker(false);
              return;
            }
            if (Platform.OS !== 'ios') setShowTimePicker(false);
            if (d) {
              setFromTimeHm(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
            }
          }}
        />
      ) : null}

      <Text style={styles.fieldLabel}>Buscar por nombre del viaje (opcional)</Text>
      <TextInput
        style={styles.textInput}
        value={routeNameFilter}
        onChangeText={setRouteNameFilter}
        placeholder="Ej. universidad, Luque, trabajo…"
        placeholderTextColor="#9ca3af"
        autoCapitalize="sentences"
        autoCorrect
        accessibilityLabel="Filtrar por nombre del viaje"
      />
      <Text style={styles.fieldHint}>
        Si el conductor puso un nombre al publicar, podés acotar la lista. Dejá vacío para ver todos.
      </Text>

      <Text style={styles.fieldLabel}>Tipo de viaje</Text>
      <View style={styles.kindRow}>
        <TouchableOpacity
          style={[styles.kindChip, rideKind === 'all' && styles.kindChipActive]}
          onPress={() => setRideKind('all')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, rideKind === 'all' && styles.kindChipTextActive]}>Todos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, rideKind === 'internal' && styles.kindChipActive]}
          onPress={() => setRideKind('internal')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, rideKind === 'internal' && styles.kindChipTextActive]}>Interno</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, rideKind === 'long_distance' && styles.kindChipActive]}
          onPress={() => setRideKind('long_distance')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, rideKind === 'long_distance' && styles.kindChipTextActive]}>
            Larga distancia
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.linkSearch} onPress={() => navigation.navigate('SearchPublishedRides')}>
        <Text style={styles.linkSearchText}>Buscar con filtros (fecha, origen, destino)</Text>
      </TouchableOpacity>

      {!isEnvConfigured() ? (
        <Text style={styles.configError}>Falta configurar Supabase en la app (URL y clave).</Text>
      ) : null}

      {loading && list.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 20, marginBottom: 8 }} size="large" color="#166534" />
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={list}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>
              No hay viajes disponibles ({timeLabel}) con los criterios actuales.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const dep = item.departure_time ? new Date(String(item.departure_time)).toLocaleString('es-PY') : '';
          const rName = String((item as { route_name?: string | null }).route_name ?? '').trim();
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('RideDetail', { rideId: String(item.id) })}
            >
              {rName ? (
                <Text style={styles.cardRouteName} numberOfLines={1}>
                  {rName}
                </Text>
              ) : null}
              <Text style={styles.cardTitle} numberOfLines={2}>
                {String(item.origin_label ?? '')} → {String(item.destination_label ?? '')}
              </Text>
              <Text style={styles.cardMeta}>{dep}</Text>
              <Text style={styles.cardMeta}>Cupos: {String(item.available_seats ?? '—')}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerBlock: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  textInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111',
    marginBottom: 6,
    backgroundColor: '#fff',
  },
  fieldHint: { fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 17 },
  pickerRow: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  pickerValue: { fontSize: 16, color: '#111' },
  pickerPlaceholder: { fontSize: 16, color: '#9ca3af' },
  clearTime: { fontSize: 13, color: '#166534', fontWeight: '600', marginBottom: 12 },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  kindChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  kindChipActive: {
    borderColor: '#166534',
    backgroundColor: '#166534',
  },
  kindChipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  kindChipTextActive: { color: '#fff' },
  linkSearch: { marginBottom: 8 },
  linkSearchText: { fontSize: 14, fontWeight: '600', color: '#166534' },
  configError: { fontSize: 13, color: '#b91c1c', marginBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#f9fafb',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardRouteName: { fontSize: 14, fontWeight: '700', color: '#14532d', marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  cardMeta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 16, lineHeight: 20, paddingHorizontal: 8 },
});
