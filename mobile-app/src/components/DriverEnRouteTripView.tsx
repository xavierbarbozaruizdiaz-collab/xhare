/**
 * Conductor con viaje en curso: mapa + bottom sheet (detalle del viaje).
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { OrderedMapVisitRow } from '../lib/buildMasterBookRidePolyline';
import type { RideStopForReserve } from '../rides/api';
import { filterOperationalDriverStops } from '../lib/rideStopKinds';

export type MapVisitProgress = 'done' | 'current' | 'upcoming';
import { formatBookingTicketCode } from '../lib/bookingCode';

const PRIMARY = '#1a5c38';
const ARRIVE_ORANGE = '#ff6b35';
const SHEET_BG = '#ffffff';
const SCREEN_BG = '#f7f8fa';

export type DriverBookingRowLite = {
  id: string;
  booking_code: string | null;
  pickup_label: string | null;
  dropoff_label: string | null;
  seats_count: number;
};

type Props = {
  onBack: () => void;
  mapNode: React.ReactNode;
  visitRows: OrderedMapVisitRow[];
  visitProgress: MapVisitProgress[];
  revenue: { count: number; totalGs: number; paidGs: number; pendingGs: number };
  publishedStops: RideStopForReserve[];
  passengersOnBus: DriverBookingRowLite[];
  onConfirmDropoff: (booking: DriverBookingRowLite) => void;
  manualDropoffBookingId: string | null;
  canPressLlegue: boolean;
  awaitingStop: boolean;
  onLlegue: () => void;
  canNavigate: boolean;
  onNavegar: () => void;
  canComplete: boolean;
  completing: boolean;
  onComplete: () => void;
  arriveGateM: number;
};

type SheetPanel = 'none' | 'route' | 'stops' | 'passengers';

function ArrivePassengerRowHeader({
  booking,
  kind,
}: {
  booking: DriverBookingRowLite;
  kind: 'dropoff';
}) {
  const ticket = formatBookingTicketCode(booking.booking_code);
  const place =
    kind === 'dropoff'
      ? booking.dropoff_label?.trim() || 'Punto de bajada'
      : booking.pickup_label?.trim() || 'Punto de subida';
  return (
    <View style={styles.passengerRowHead}>
      {ticket ? <Text style={styles.passengerTicket}>{ticket}</Text> : null}
      <Text style={styles.passengerPlace} numberOfLines={2}>
        {place}
      </Text>
    </View>
  );
}

export function DriverEnRouteTripView({
  onBack,
  mapNode,
  visitRows,
  visitProgress,
  revenue,
  publishedStops,
  passengersOnBus,
  onConfirmDropoff,
  manualDropoffBookingId,
  canPressLlegue,
  awaitingStop,
  onLlegue,
  canNavigate,
  onNavegar,
  canComplete,
  completing,
  onComplete,
  arriveGateM,
}: Props) {
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<SheetPanel>('none');

  const totalStops = visitRows.length;
  const completedStops = useMemo(
    () => visitProgress.filter((p) => p === 'done').length,
    [visitProgress]
  );
  const progressPct =
    totalStops > 0 ? Math.min(100, Math.round((completedStops / totalStops) * 100)) : 0;

  const paymentConfirmed = revenue.totalGs > 0 && revenue.pendingGs <= 0;

  const togglePanel = (next: SheetPanel) => {
    setPanel((p) => (p === next ? 'none' : next));
  };

  const operationalStops = useMemo(
    () => filterOperationalDriverStops([...publishedStops].sort((a, b) => a.stop_order - b.stop_order)),
    [publishedStops]
  );

  return (
    <View style={styles.root}>
      <View style={[styles.mapZone, { paddingTop: insets.top }]}>
        <View style={styles.mapHeader}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.mapHeaderTitle}>Detalle del viaje</Text>
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>EN CURSO</Text>
          </View>
        </View>
        <View style={styles.mapFill}>{mapNode}</View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {revenue.count > 0 ? (
            <View style={styles.earningsCard}>
              <View style={styles.earningsTopRow}>
                <View style={styles.earningsColLeft}>
                  <Text style={styles.earningsLabel}>TOTAL ACORDADO</Text>
                  <Text style={styles.earningsTotal}>₲ {revenue.totalGs.toLocaleString('es-PY')}</Text>
                  <Text style={styles.earningsSub}>
                    {revenue.count === 1 ? '1 reserva activa' : `${revenue.count} reservas activas`}
                  </Text>
                </View>
                <View style={styles.earningsColRight}>
                  <Text style={styles.earningsPaidLabel}>Cobrado</Text>
                  <Text style={styles.earningsPaidAmount}>₲ {revenue.paidGs.toLocaleString('es-PY')}</Text>
                  <View style={styles.earningsStatusRow}>
                    <View style={styles.earningsStatusDot} />
                    <Text style={styles.earningsStatusText}>
                      {paymentConfirmed ? 'Confirmado' : 'Pendiente'}
                    </Text>
                  </View>
                </View>
              </View>
              {totalStops > 0 ? (
                <>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                  </View>
                  <View style={styles.progressLabels}>
                    <Text style={styles.progressLeft}>
                      {completedStops} de {totalStops} paradas completadas
                    </Text>
                    <Text style={styles.progressRight}>{progressPct}%</Text>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          <View style={styles.quickRow}>
            <QuickAction
              icon="map-outline"
              label="Recorrido"
              active={panel === 'route'}
              onPress={() => togglePanel('route')}
            />
            <QuickAction
              icon="time-outline"
              label="Paradas"
              active={panel === 'stops'}
              onPress={() => togglePanel('stops')}
            />
            <QuickAction
              icon="people-outline"
              label="Pasajeros"
              active={panel === 'passengers'}
              onPress={() => togglePanel('passengers')}
            />
          </View>

          {panel === 'route' ? (
            <SheetPanelBox title={`Recorrido (${visitRows.length} puntos)`}>
              {visitRows.map((row, i) => {
                const progress = visitProgress[i] ?? 'upcoming';
                const kindLabel =
                  row.kind === 'published' ? 'Publicación' : row.kind === 'pickup' ? 'Subida' : 'Bajada';
                return (
                  <View
                    key={`${row.kind}-${row.bookingId ?? ''}-${row.rideStopId ?? ''}-${i}`}
                    style={[
                      styles.visitRow,
                      progress === 'done' && styles.visitRowDone,
                      progress === 'current' && styles.visitRowCurrent,
                    ]}
                  >
                    <Text style={styles.visitOrder}>{i + 1}</Text>
                    <View style={styles.visitTextCol}>
                      <Text style={styles.visitKind}>{kindLabel}</Text>
                      <Text style={styles.visitTitle}>{row.title}</Text>
                      {row.subtitle ? (
                        <Text style={styles.visitSubtitle} numberOfLines={3}>
                          {row.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {progress === 'current' ? (
                      <Text style={styles.visitCurrentBadge}>En camino</Text>
                    ) : null}
                  </View>
                );
              })}
            </SheetPanelBox>
          ) : null}

          {panel === 'stops' ? (
            <SheetPanelBox title="Paradas de tu publicación">
              {operationalStops.length === 0 ? (
                <Text style={styles.panelMuted}>No hay paradas publicadas en este viaje.</Text>
              ) : (
                operationalStops.map((s, i) => (
                  <View key={s.id} style={styles.stopLine}>
                    <Text style={styles.stopLineOrder}>{i + 1}.</Text>
                    <Text style={styles.stopLineLabel}>
                      {s.label?.trim() || (i === 0 ? 'Salida' : i === operationalStops.length - 1 ? 'Llegada' : 'Parada')}
                    </Text>
                  </View>
                ))
              )}
            </SheetPanelBox>
          ) : null}

          {panel === 'passengers' ? (
            <SheetPanelBox title="Pasajeros">
              {passengersOnBus.length === 0 ? (
                <Text style={styles.panelMuted}>Nadie a bordo por ahora.</Text>
              ) : (
                passengersOnBus.map((b) => {
                  const busy = manualDropoffBookingId === b.id;
                  return (
                    <View key={b.id} style={styles.passengerActionRow}>
                      <ArrivePassengerRowHeader booking={b} kind="dropoff" />
                      <TouchableOpacity
                        style={styles.passengerDropBtn}
                        disabled={busy}
                        onPress={() => onConfirmDropoff(b)}
                      >
                        <Text style={styles.passengerDropBtnText}>{busy ? 'Guardando…' : 'Bajó'}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
              <Text style={styles.panelHint}>
                Podés marcar la bajada en cualquier momento; no hace falta estar en el punto del mapa.
              </Text>
            </SheetPanelBox>
          ) : null}

          {awaitingStop ? (
            <Text style={styles.awaitingBanner}>
              Confirmá subidas o bajadas en el diálogo abierto para seguir el recorrido.
            </Text>
          ) : null}

          <View style={styles.ctaRow}>
            {!awaitingStop ? (
              <TouchableOpacity
                style={[
                  styles.ctaLlegue,
                  !canPressLlegue && styles.ctaDisabled,
                ]}
                disabled={!canPressLlegue}
                onPress={onLlegue}
                accessibilityRole="button"
                accessibilityLabel="Llegué al punto"
              >
                <Ionicons name="location" size={18} color="#fff" />
                <Text style={styles.ctaLlegueText}>Llegué</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.ctaNavegar, awaitingStop && styles.ctaNavegarSolo, !canNavigate && styles.ctaDisabled]}
              disabled={!canNavigate}
              onPress={onNavegar}
              accessibilityRole="button"
              accessibilityLabel="Navegar a la parada actual"
            >
              <Ionicons name="navigate" size={18} color="#fff" />
              <Text style={styles.ctaNavegarText}>Navegar</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.helpText}>
            {`"Llegué" se activa a ≤${arriveGateM} m del punto de parada`}
          </Text>

          {canComplete ? (
            <TouchableOpacity
              style={[styles.completeBtn, completing && styles.ctaDisabled]}
              disabled={completing}
              onPress={onComplete}
              accessibilityRole="button"
              accessibilityLabel="Finalizar viaje"
            >
              {completing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.completeBtnText}>Finalizar viaje</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, active && styles.quickBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={active ? PRIMARY : '#555'} />
      <Text style={[styles.quickBtnLabel, active && styles.quickBtnLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SheetPanelBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panelBox}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  mapZone: { flex: 0.52, backgroundColor: PRIMARY, minHeight: 220 },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapHeaderTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  statusChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusChipText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  mapFill: { flex: 1, minHeight: 160 },
  sheet: {
    flex: 1,
    marginTop: -20,
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    zIndex: 5,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginTop: 10,
    marginBottom: 8,
  },
  sheetScroll: { flex: 1 },
  sheetScrollContent: { paddingBottom: 28 },
  earningsCard: {
    backgroundColor: '#f0f7f3',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 14,
    marginBottom: 12,
  },
  earningsTopRow: { flexDirection: 'row', gap: 12 },
  earningsColLeft: { flex: 1, minWidth: 0 },
  earningsColRight: { alignItems: 'flex-end' },
  earningsLabel: {
    color: PRIMARY,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  earningsTotal: { fontSize: 26, fontWeight: '700', color: '#1a1f2e', marginTop: 2 },
  earningsSub: { fontSize: 12, color: '#666', marginTop: 2 },
  earningsPaidLabel: { fontSize: 11, color: '#888' },
  earningsPaidAmount: { fontSize: 18, fontWeight: '700', color: PRIMARY, marginTop: 2 },
  earningsStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  earningsStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  earningsStatusText: { fontSize: 11, color: '#22c55e', fontWeight: '600' },
  progressTrack: {
    height: 5,
    borderRadius: 4,
    backgroundColor: '#d1e8da',
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: PRIMARY, borderRadius: 4 },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressLeft: { fontSize: 10, color: '#888' },
  progressRight: { fontSize: 10, color: PRIMARY, fontWeight: '700' },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
  },
  quickBtnActive: { backgroundColor: '#e8f5ec', borderWidth: 1, borderColor: '#b8dcc8' },
  quickBtnLabel: { fontSize: 11, fontWeight: '600', color: '#555' },
  quickBtnLabelActive: { color: PRIMARY },
  panelBox: {
    marginHorizontal: 14,
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  panelTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  panelMuted: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  panelHint: { fontSize: 11, color: '#9ca3af', marginTop: 8, lineHeight: 16 },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  visitRowDone: { opacity: 0.65 },
  visitRowCurrent: { backgroundColor: '#fff7ed', marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 8 },
  visitOrder: { fontSize: 14, fontWeight: '700', color: PRIMARY, width: 22 },
  visitTextCol: { flex: 1, minWidth: 0 },
  visitKind: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' },
  visitTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  visitSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  visitCurrentBadge: { fontSize: 10, fontWeight: '700', color: ARRIVE_ORANGE },
  stopLine: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  stopLineOrder: { fontWeight: '700', color: PRIMARY, width: 22 },
  stopLineLabel: { flex: 1, fontSize: 14, color: '#374151' },
  passengerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  passengerRowHead: { flex: 1, minWidth: 0 },
  passengerTicket: { fontSize: 12, fontWeight: '800', color: PRIMARY },
  passengerPlace: { fontSize: 13, color: '#374151', marginTop: 2 },
  passengerDropBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  passengerDropBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  awaitingBanner: {
    marginHorizontal: 14,
    marginBottom: 10,
    fontSize: 13,
    color: '#92400e',
    backgroundColor: '#fffbeb',
    padding: 10,
    borderRadius: 10,
    overflow: 'hidden',
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  ctaLlegue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: ARRIVE_ORANGE,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 12,
  },
  ctaLlegueText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ctaNavegar: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 12,
  },
  ctaNavegarSolo: { flex: 1 },
  ctaNavegarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ctaDisabled: { opacity: 0.45 },
  helpText: {
    textAlign: 'center',
    fontSize: 11,
    color: '#aaa',
    marginTop: 10,
    paddingHorizontal: 14,
  },
  completeBtn: {
    marginHorizontal: 14,
    marginTop: 14,
    backgroundColor: '#1d4ed8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  completeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
