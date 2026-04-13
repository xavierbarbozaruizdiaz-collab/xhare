import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export type SystemGeneratedRideRow = Record<string, unknown> & { id: string };

function formatDeparture(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SystemGeneratedRideCard({
  r,
  passengerSeats,
  onOpenDetail,
}: {
  r: SystemGeneratedRideRow;
  passengerSeats: number;
  onOpenDetail: () => void;
}) {
  const origin = String(r.origin_label ?? 'Origen');
  const dest = String(r.destination_label ?? 'Destino');
  return (
    <View style={styles.dispatchCard}>
      <View style={styles.dispatchBadgeRow}>
        <View style={styles.dispatchBadge}>
          <Text style={styles.dispatchBadgeText}>Generado</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onOpenDetail} accessibilityRole="button" accessibilityLabel="Ver detalle del viaje generado">
        <Text style={styles.when}>{formatDeparture(r.departure_time as string)}</Text>
        <Text style={styles.route} numberOfLines={2}>
          {origin} → {dest}
        </Text>
        <Text style={styles.meta}>Pasajeros: {passengerSeats}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.assignPlaceholderWrap}
        disabled
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel="Asignar conductor, no disponible aún"
      >
        <Text style={styles.assignPlaceholderBtn}>Asignar conductor</Text>
        <Text style={styles.assignPlaceholderHint}>Próximamente</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  dispatchCard: {
    backgroundColor: '#f0fdfa',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#14b8a6',
  },
  dispatchBadgeRow: { flexDirection: 'row', marginBottom: 8 },
  dispatchBadge: {
    backgroundColor: '#0d9488',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  dispatchBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  when: { fontSize: 13, fontWeight: '600', color: '#166534', marginBottom: 6 },
  route: { fontSize: 15, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  assignPlaceholderWrap: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#e5e7eb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    opacity: 0.85,
  },
  assignPlaceholderBtn: { color: '#6b7280', fontSize: 15, fontWeight: '700' },
  assignPlaceholderHint: { fontSize: 11, color: '#9ca3af', marginTop: 4, fontWeight: '600' },
});
