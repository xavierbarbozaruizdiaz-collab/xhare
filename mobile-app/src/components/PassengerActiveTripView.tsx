/**
 * Pasajero con reserva activa: mapa fijo + bottom sheet (sin scroll de pantalla completa).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { formatBookingTicketCode } from '../lib/bookingCode';
import { formatProfileRatingLabel } from '../lib/profileRating';

const PRIMARY = '#1a5c38';
const SCREEN_BG = '#f7f8fa';
const PENDING_ORANGE = '#ea580c';

export type PassengerHeaderChip = 'RESERVADO' | 'CONFIRMADO' | 'COMPLETADO';

type DriverCardInfo = {
  fullName: string;
  avatarUrl: string | null;
  ratingAverage?: number | null;
  ratingCount?: number | null;
  vehicleModel: string;
  availableSeats: number;
  totalSeats: number;
};

type Props = {
  onBack: () => void;
  headerChip: PassengerHeaderChip;
  mapNode: React.ReactNode;
  ticketCode: string | null;
  totalPaid: number;
  seatsCount: number;
  paymentPaid: boolean;
  driver: DriverCardInfo | null;
  canMessage: boolean;
  messageEnabled: boolean;
  messageHint?: string;
  contactingDriver: boolean;
  onMessage: () => void;
  pickupLabel: string | null;
  dropoffLabel: string | null;
  canShareTracking: boolean;
  onShareTracking: () => void;
  canCancelBooking: boolean;
  cancellingBooking: boolean;
  onCancelBooking: () => void;
};

export function passengerHeaderChipForBooking(
  bookingStatus: string,
  rideStatus: string,
  tripEnded: boolean
): PassengerHeaderChip {
  if (tripEnded || rideStatus === 'completed' || rideStatus === 'cancelled') return 'COMPLETADO';
  const bs = String(bookingStatus ?? '').toLowerCase();
  if (bs === 'completed' || bs === 'cancelled') return 'COMPLETADO';
  if (bs === 'confirmed') return 'CONFIRMADO';
  return 'RESERVADO';
}

export function PassengerActiveTripView({
  onBack,
  headerChip,
  mapNode,
  ticketCode,
  totalPaid,
  seatsCount,
  paymentPaid,
  driver,
  canMessage,
  messageEnabled,
  messageHint,
  contactingDriver,
  onMessage,
  pickupLabel,
  dropoffLabel,
  canShareTracking,
  onShareTracking,
  canCancelBooking,
  cancellingBooking,
  onCancelBooking,
}: Props) {
  const insets = useSafeAreaInsets();
  const [routeOpen, setRouteOpen] = useState(false);
  const ticketDisplay = formatBookingTicketCode(ticketCode) || '—';
  const ratingLabel =
    driver && driver.ratingAverage != null
      ? formatProfileRatingLabel(driver.ratingAverage, driver.ratingCount ?? 0)
      : null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityLabel="Volver">
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalle del viaje</Text>
        <View style={styles.headerChip}>
          <Text style={styles.headerChipText}>{headerChip}</Text>
        </View>
      </View>

      <View style={styles.mapZone}>{mapNode}</View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.ticketOuter}>
            <View style={styles.ticketNotchLeft} />
            <View style={styles.ticketNotchRight} />
            <View style={styles.ticketInner}>
              <Text style={styles.ticketLabel}>MI TICKET</Text>
              <Text style={styles.ticketCode}>{ticketDisplay}</Text>
              <View style={styles.ticketDivider} />
              <View style={styles.ticketCols}>
                <View style={styles.ticketCol}>
                  <Text style={styles.ticketColLabel}>TOTAL</Text>
                  <Text style={styles.ticketColValue}>₲ {totalPaid.toLocaleString('es-PY')}</Text>
                </View>
                <View style={styles.ticketColSep} />
                <View style={styles.ticketCol}>
                  <Text style={styles.ticketColLabel}>ASIENTOS</Text>
                  <Text style={styles.ticketColValue}>{seatsCount}</Text>
                </View>
                <View style={styles.ticketColSep} />
                <View style={styles.ticketCol}>
                  <Text style={styles.ticketColLabel}>PAGO</Text>
                  <View style={styles.payRow}>
                    <View
                      style={[styles.payDot, paymentPaid ? styles.payDotOk : styles.payDotPending]}
                    />
                    <Text style={[styles.payText, paymentPaid ? styles.payTextOk : styles.payTextPending]}>
                      {paymentPaid ? 'Pagado' : 'Pendiente'}
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={styles.ticketHint}>Mostrá este código al subir al minibús</Text>
            </View>
          </View>

          {driver ? (
            <View style={styles.driverCard}>
              <View style={styles.driverAvatarWrap}>
                {driver.avatarUrl ? (
                  <Image source={{ uri: driver.avatarUrl }} style={styles.driverAvatar} />
                ) : (
                  <View style={styles.driverAvatarPlaceholder}>
                    <Ionicons name="person" size={22} color={PRIMARY} />
                  </View>
                )}
              </View>
              <View style={styles.driverCenter}>
                <Text style={styles.driverLabel}>CONDUCTOR</Text>
                <Text style={styles.driverName} numberOfLines={1}>
                  {driver.fullName}
                </Text>
                {ratingLabel ? (
                  <Text style={styles.driverRating}>★ {ratingLabel}</Text>
                ) : null}
              </View>
              <View style={styles.driverRight}>
                {driver.vehicleModel ? (
                  <Text style={styles.vehicleModel} numberOfLines={2}>
                    {driver.vehicleModel}
                  </Text>
                ) : null}
                <Text style={styles.seatsLine}>
                  {driver.availableSeats} cupo{driver.availableSeats !== 1 ? 's' : ''} disponible
                  {driver.availableSeats !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          ) : null}

          {routeOpen ? (
            <View style={styles.routePanel}>
              <Text style={styles.routePanelTitle}>Tu recorrido</Text>
              <Text style={styles.routePanelLabel}>Subida</Text>
              <Text style={styles.routePanelText}>
                {pickupLabel ?? 'Ubicación elegida en el mapa al reservar.'}
              </Text>
              <Text style={styles.routePanelLabel}>Bajada</Text>
              <Text style={styles.routePanelText}>
                {dropoffLabel ?? 'Ubicación elegida en el mapa al reservar.'}
              </Text>
            </View>
          ) : null}

          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={styles.ctaRoute}
              onPress={() => setRouteOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={routeOpen ? 'Ocultar ruta' : 'Ver ruta'}
            >
              <Ionicons name="location-outline" size={18} color="#374151" />
              <Text style={styles.ctaRouteText}>{routeOpen ? 'Ocultar' : 'Ver ruta'}</Text>
            </TouchableOpacity>
            {canMessage ? (
              <TouchableOpacity
                style={[styles.ctaMessage, (!messageEnabled || contactingDriver) && styles.ctaDisabled]}
                disabled={!messageEnabled || contactingDriver}
                onPress={onMessage}
                accessibilityRole="button"
                accessibilityLabel="Mensaje al conductor"
              >
                {contactingDriver ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                    <Text style={styles.ctaMessageText}>Mensaje al conductor</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          {!messageEnabled && messageHint ? (
            <Text style={styles.messageHint}>{messageHint}</Text>
          ) : null}

          {canShareTracking ? (
            <TouchableOpacity style={styles.shareBtn} onPress={onShareTracking}>
              <Ionicons name="share-social-outline" size={18} color={PRIMARY} />
              <Text style={styles.shareBtnText}>Compartir seguimiento</Text>
            </TouchableOpacity>
          ) : null}

          {canCancelBooking ? (
            <TouchableOpacity
              style={styles.cancelLink}
              onPress={onCancelBooking}
              disabled={cancellingBooking}
            >
              <Text style={styles.cancelLinkText}>
                {cancellingBooking ? 'Cancelando…' : 'Cancelar reserva'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: PRIMARY,
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
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '600' },
  headerChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  headerChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  mapZone: { height: 220, backgroundColor: '#e5e7eb' },
  sheet: {
    flex: 1,
    marginTop: -16,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    zIndex: 5,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetScroll: { flex: 1 },
  sheetContent: { paddingHorizontal: 14, paddingBottom: 20 },
  ticketOuter: { position: 'relative', marginBottom: 12 },
  ticketNotchLeft: {
    position: 'absolute',
    left: -13,
    top: '50%',
    marginTop: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SCREEN_BG,
    zIndex: 2,
  },
  ticketNotchRight: {
    position: 'absolute',
    right: -13,
    top: '50%',
    marginTop: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SCREEN_BG,
    zIndex: 2,
  },
  ticketInner: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: PRIMARY,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  ticketLabel: {
    textAlign: 'center',
    fontSize: 10,
    color: '#888',
    letterSpacing: 1,
    fontWeight: '600',
  },
  ticketCode: {
    textAlign: 'center',
    fontSize: 32,
    fontWeight: '700',
    color: PRIMARY,
    marginTop: 4,
  },
  ticketDivider: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    marginVertical: 12,
  },
  ticketCols: { flexDirection: 'row', alignItems: 'center' },
  ticketCol: { flex: 1, alignItems: 'center' },
  ticketColSep: { width: 1, height: 36, backgroundColor: '#e5e7eb' },
  ticketColLabel: { fontSize: 10, color: '#888', fontWeight: '600', marginBottom: 4 },
  ticketColValue: { fontSize: 18, fontWeight: '700', color: '#1a1f2e' },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  payDot: { width: 6, height: 6, borderRadius: 3 },
  payDotOk: { backgroundColor: '#22c55e' },
  payDotPending: { backgroundColor: PENDING_ORANGE },
  payText: { fontSize: 12, fontWeight: '700' },
  payTextOk: { color: '#22c55e' },
  payTextPending: { color: PENDING_ORANGE },
  ticketHint: { textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 12 },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SCREEN_BG,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  driverAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: PRIMARY,
    overflow: 'hidden',
  },
  driverAvatar: { width: 44, height: 44, borderRadius: 22 },
  driverAvatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5ec',
  },
  driverCenter: { flex: 1, minWidth: 0 },
  driverLabel: { fontSize: 10, color: '#888', letterSpacing: 0.5, fontWeight: '600' },
  driverName: { fontSize: 15, fontWeight: '600', color: '#111827', marginTop: 2 },
  driverRating: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  driverRight: { alignItems: 'flex-end', maxWidth: 100 },
  vehicleModel: { fontSize: 10, color: '#888', textAlign: 'right' },
  seatsLine: { fontSize: 12, color: '#555', marginTop: 4, textAlign: 'right' },
  routePanel: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  routePanelTitle: { fontSize: 13, fontWeight: '700', color: PRIMARY, marginBottom: 8 },
  routePanelLabel: { fontSize: 11, color: '#6b7280', marginTop: 6, textTransform: 'uppercase' },
  routePanelText: { fontSize: 14, color: '#374151', marginTop: 2 },
  ctaRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  ctaRoute: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f5f5f5',
    borderRadius: 14,
    paddingVertical: 14,
  },
  ctaRouteText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  ctaMessage: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 14,
  },
  ctaMessageText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ctaDisabled: { opacity: 0.5 },
  messageHint: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginBottom: 8 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginBottom: 6,
  },
  shareBtnText: { color: PRIMARY, fontWeight: '700', fontSize: 13 },
  cancelLink: { alignItems: 'center', paddingVertical: 8 },
  cancelLinkText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
});
