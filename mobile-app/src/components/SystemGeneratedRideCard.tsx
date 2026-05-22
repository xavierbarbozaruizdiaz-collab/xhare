import React from 'react';
import { appBrand } from '../ui/theme/brand';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';

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
    <TouchableOpacity
      style={styles.card}
      onPress={onOpenDetail}
      accessibilityRole="button"
      accessibilityLabel="Publicar viaje para esta ruta de sistema"
    >
      <Text style={styles.when}>{formatDeparture(r.departure_time as string)}</Text>
      <Text style={styles.route} numberOfLines={2}>
        {origin} → {dest}
      </Text>
      <Text style={styles.meta}>
        Pasajeros: {passengerSeats}
      </Text>
      <Text style={styles.hint}>Tocá para publicar un viaje para esta ruta</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  when: { fontSize: 13, fontWeight: '600', color: appBrand.colors.primary, marginBottom: 6 },
  route: { fontSize: 15, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
});
