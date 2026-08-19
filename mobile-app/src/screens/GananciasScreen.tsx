/**
 * Ganancias (conductor): recaudo diario / semanal / mensual + lo pendiente por uso de la app.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { appBrand } from '../ui/theme/brand';
import {
  type EarningsPeriod,
  type DriverPeriodEarnings,
  type DriverAppFeeSummary,
  periodBoundsIso,
  formatDriverMoneyGs,
  fetchDriverPeriodEarnings,
  fetchDriverAppFeeSummary,
} from '../lib/driverEarningsSummary';

const PERIODS: Array<{ id: EarningsPeriod; short: string }> = [
  { id: 'day', short: 'Diario' },
  { id: 'week', short: 'Semanal' },
  { id: 'month', short: 'Mensual' },
];

export function GananciasScreen() {
  const { session } = useAuth();
  const driverId = session?.id ?? '';
  const [period, setPeriod] = useState<EarningsPeriod>('day');
  const [earnings, setEarnings] = useState<DriverPeriodEarnings | null>(null);
  const [fees, setFees] = useState<DriverAppFeeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (soft = false) => {
      if (!driverId) {
        setEarnings(null);
        setFees(null);
        setLoading(false);
        return;
      }
      if (!soft) setLoading(true);
      try {
        const [e, f] = await Promise.all([
          fetchDriverPeriodEarnings(driverId, period),
          fetchDriverAppFeeSummary(driverId),
        ]);
        setEarnings(e);
        setFees(f);
      } catch {
        setEarnings({ collectedGs: 0, agreedGs: 0, rideCount: 0, paidBookingCount: 0 });
        setFees(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [driverId, period],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const periodLabel = periodBoundsIso(period).label;
  const netEstimate =
    earnings && fees
      ? Math.max(0, earnings.collectedGs - Math.round((earnings.collectedGs * fees.feePercent) / 100))
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={appBrand.colors.primary}
          />
        }
      >
        <Text style={styles.eyebrow}>Tu dinero</Text>
        <Text style={styles.title}>Ganancias</Text>
        <Text style={styles.subtitle}>
          Recaudo confirmado en la app y lo pendiente por comisión de uso.
        </Text>

        <View style={styles.periodRow}>
          {PERIODS.map((p) => {
            const active = period === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.periodChip, active && styles.periodChipActive]}
                onPress={() => setPeriod(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>
                  {p.short}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading && !earnings ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={appBrand.colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Recaudado · {periodLabel}</Text>
              <Text style={styles.heroValue}>
                {formatDriverMoneyGs(earnings?.collectedGs ?? 0)}
              </Text>
              <Text style={styles.heroMeta}>
                {earnings?.rideCount ?? 0} viaje{(earnings?.rideCount ?? 0) === 1 ? '' : 's'} ·{' '}
                {earnings?.paidBookingCount ?? 0} cobro
                {(earnings?.paidBookingCount ?? 0) === 1 ? '' : 's'} confirmado
                {(earnings?.paidBookingCount ?? 0) === 1 ? '' : 's'}
              </Text>
            </View>

            <View style={styles.grid}>
              <View style={styles.miniCard}>
                <Text style={styles.miniLabel}>Acordado</Text>
                <Text style={styles.miniValue}>{formatDriverMoneyGs(earnings?.agreedGs ?? 0)}</Text>
                <Text style={styles.miniHint}>Según reservas activas</Text>
              </View>
              <View style={styles.miniCard}>
                <Text style={styles.miniLabel}>Estimado neto</Text>
                <Text style={styles.miniValue}>
                  {formatDriverMoneyGs(netEstimate ?? 0)}
                </Text>
                <Text style={styles.miniHint}>
                  Tras ~{fees?.feePercent ?? 10}% de comisión
                </Text>
              </View>
            </View>
          </>
        )}

        <View style={styles.sectionHeader}>
          <Ionicons name="phone-portrait-outline" size={18} color={appBrand.colors.primary} />
          <Text style={styles.sectionTitle}>Uso de la app</Text>
        </View>

        <View style={styles.feeCard}>
          {fees == null && loading ? (
            <ActivityIndicator color={appBrand.colors.primary} />
          ) : (
            <>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Comisión actual</Text>
                <Text style={styles.feeValue}>{fees?.feePercent ?? 10}%</Text>
              </View>
              <Text style={styles.feeHint}>
                Se calcula al completar cada viaje sobre lo recaudado de ese viaje.
              </Text>

              <View style={styles.feeDivider} />

              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Pendiente de pagar</Text>
                <Text style={[styles.feeValue, styles.feeValueWarn]}>
                  {formatDriverMoneyGs(fees?.debtPyg ?? 0)}
                </Text>
              </View>
              <Text style={styles.feeHint}>
                {fees?.pendingChargesCount ?? 0} cargo
                {(fees?.pendingChargesCount ?? 0) === 1 ? '' : 's'} pendiente
                {(fees?.pendingChargesCount ?? 0) === 1 ? '' : 's'}
              </Text>

              <View style={[styles.feeRow, styles.feeRowSpaced]}>
                <Text style={styles.feeLabel}>Límite para pago</Text>
                <Text style={styles.feeValue}>
                  {formatDriverMoneyGs(fees?.debtLimitPyg ?? 0)}
                </Text>
              </View>
              <Text style={styles.feeHint}>
                Si lo pendiente supera este límite, la cuenta puede suspenderse.
                {fees != null
                  ? ` Te quedan ${formatDriverMoneyGs(Math.max(0, fees.debtLimitPyg - fees.debtPyg))} antes del tope.`
                  : ''}
              </Text>

              {fees?.accountStatus === 'suspended' ? (
                <View style={styles.suspendedBanner}>
                  <Ionicons name="warning-outline" size={18} color="#92400e" />
                  <Text style={styles.suspendedText}>
                    Tu cuenta está suspendida por deuda. Regularizá el pago para seguir publicando.
                  </Text>
                </View>
              ) : null}

              <Text style={styles.payNote}>
                El pago de la comisión se gestiona con el equipo de ÑandeBus (no se cobra solo desde
                esta pantalla).
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: appBrand.colors.background },
  content: { padding: 20, paddingBottom: 40 },
  eyebrow: {
    fontSize: 13,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.medium,
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontFamily: appBrand.fonts.semibold,
    color: appBrand.colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.regular,
    marginBottom: 18,
  },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: appBrand.colors.surface,
    borderWidth: 1,
    borderColor: appBrand.colors.border,
    alignItems: 'center',
  },
  periodChipActive: {
    backgroundColor: appBrand.colors.primary,
    borderColor: appBrand.colors.primary,
  },
  periodChipText: {
    fontSize: 13,
    fontFamily: appBrand.fonts.semibold,
    color: appBrand.colors.textMuted,
  },
  periodChipTextActive: { color: appBrand.colors.white },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    backgroundColor: appBrand.colors.surface,
    borderRadius: 20,
    marginBottom: 16,
  },
  heroCard: {
    backgroundColor: appBrand.colors.primary,
    borderRadius: 22,
    padding: 20,
    marginBottom: 12,
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: appBrand.fonts.medium,
    marginBottom: 6,
  },
  heroValue: {
    color: '#fff',
    fontSize: 32,
    fontFamily: appBrand.fonts.semibold,
    marginBottom: 8,
  },
  heroMeta: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontFamily: appBrand.fonts.regular,
  },
  grid: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  miniCard: {
    flex: 1,
    backgroundColor: appBrand.colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: appBrand.colors.border,
  },
  miniLabel: {
    fontSize: 12,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.medium,
    marginBottom: 6,
  },
  miniValue: {
    fontSize: 16,
    color: appBrand.colors.primary,
    fontFamily: appBrand.fonts.semibold,
    marginBottom: 4,
  },
  miniHint: {
    fontSize: 11,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.regular,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: appBrand.fonts.semibold,
    color: appBrand.colors.text,
  },
  feeCard: {
    backgroundColor: appBrand.colors.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: appBrand.colors.border,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  feeRowSpaced: {
    marginTop: 14,
  },
  feeLabel: {
    fontSize: 14,
    fontFamily: appBrand.fonts.medium,
    color: appBrand.colors.text,
  },
  feeValue: {
    fontSize: 16,
    fontFamily: appBrand.fonts.semibold,
    color: appBrand.colors.primary,
  },
  feeValueWarn: { color: appBrand.colors.accent },
  feeHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.regular,
  },
  feeDivider: {
    height: 1,
    backgroundColor: appBrand.colors.border,
    marginVertical: 14,
  },
  suspendedBanner: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  suspendedText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#92400e',
    fontFamily: appBrand.fonts.medium,
  },
  payNote: {
    marginTop: 14,
    fontSize: 12,
    lineHeight: 17,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.regular,
  },
});
