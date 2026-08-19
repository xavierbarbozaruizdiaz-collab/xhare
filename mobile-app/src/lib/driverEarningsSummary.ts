/**
 * Resumen de recaudo del conductor (por periodo) y deuda de uso de la app.
 * Recaudo = bookings cobrados (payment_status=paid). Comisión = driver_charges / driver_accounts.
 */
import { supabase } from '../backend/supabase';
import {
  computeEffectivePricing,
  loadActivePricingSettings,
  normalizeDriverDebtLimit,
  DRIVER_DEBT_LIMIT_FALLBACK,
} from './pricing/runtime-pricing';

export type EarningsPeriod = 'day' | 'week' | 'month';

export function localCalendarYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inicio/fin del día local → ISO para filtrar timestamptz. */
export function localDayBoundsIso(ymd: string): { startIso: string; endIso: string } {
  const start = new Date(`${ymd}T00:00:00`);
  const end = new Date(`${ymd}T23:59:59.999`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function periodBoundsIso(
  period: EarningsPeriod,
  now = new Date(),
): { startIso: string; endIso: string; label: string } {
  const todayYmd = localCalendarYmd(now);
  if (period === 'day') {
    const b = localDayBoundsIso(todayYmd);
    return { ...b, label: 'Hoy' };
  }
  if (period === 'week') {
    const start = new Date(now);
    const dow = start.getDay(); // 0=domingo
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    start.setDate(start.getDate() - daysFromMonday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startIso: start.toISOString(), endIso: end.toISOString(), label: 'Esta semana' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString(), label: 'Este mes' };
}

export function formatDriverMoneyGs(gs: number, compact = false): string {
  const n = Math.max(0, Math.round(Number(gs) || 0));
  if (!compact) {
    return `₲ ${n.toLocaleString('es-PY')}`;
  }
  if (n <= 0) return '₲0';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `₲${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 10_000) return `₲${Math.round(n / 1000)}k`;
  return `₲${n.toLocaleString('es-PY')}`;
}

/** Alias compacto usado en tarjetas del Home. */
export function formatDriverRecaudoStat(gs: number): string {
  return formatDriverMoneyGs(gs, true);
}

export type DriverPeriodEarnings = {
  collectedGs: number;
  agreedGs: number;
  rideCount: number;
  paidBookingCount: number;
};

export async function fetchDriverPeriodEarnings(
  driverId: string,
  period: EarningsPeriod,
): Promise<DriverPeriodEarnings> {
  const { startIso, endIso } = periodBoundsIso(period);
  const { data: rides, error } = await supabase
    .from('rides')
    .select('id')
    .eq('driver_id', driverId)
    .gte('departure_time', startIso)
    .lte('departure_time', endIso);
  if (error) {
    return { collectedGs: 0, agreedGs: 0, rideCount: 0, paidBookingCount: 0 };
  }
  const ids = (rides ?? [])
    .map((r) => String((r as { id?: unknown }).id ?? '').trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return { collectedGs: 0, agreedGs: 0, rideCount: 0, paidBookingCount: 0 };
  }
  const { data: bookings, error: bookErr } = await supabase
    .from('bookings')
    .select('price_paid, payment_status, status')
    .in('ride_id', ids)
    .neq('status', 'cancelled');
  if (bookErr) {
    return { collectedGs: 0, agreedGs: 0, rideCount: ids.length, paidBookingCount: 0 };
  }
  let collectedGs = 0;
  let agreedGs = 0;
  let paidBookingCount = 0;
  for (const row of bookings ?? []) {
    const amt = Math.max(0, Math.round(Number((row as { price_paid?: unknown }).price_paid ?? 0)));
    agreedGs += amt;
    if (String((row as { payment_status?: unknown }).payment_status ?? '').toLowerCase() === 'paid') {
      collectedGs += amt;
      paidBookingCount += 1;
    }
  }
  return { collectedGs, agreedGs, rideCount: ids.length, paidBookingCount };
}

export type DriverAppFeeSummary = {
  debtPyg: number;
  debtLimitPyg: number;
  accountStatus: string;
  pendingChargesCount: number;
  pendingChargesPyg: number;
  feePercent: number;
};

export async function fetchDriverAppFeeSummary(driverId: string): Promise<DriverAppFeeSummary> {
  const [accountRes, chargesRes, pricingRow] = await Promise.all([
    supabase
      .from('driver_accounts')
      .select('debt_pyg, debt_limit_pyg, account_status')
      .eq('driver_id', driverId)
      .maybeSingle(),
    supabase
      .from('driver_charges')
      .select('amount_pyg, status')
      .eq('driver_id', driverId)
      .eq('status', 'pending'),
    loadActivePricingSettings(),
  ]);

  const acct = accountRes.data as {
    debt_pyg?: number | null;
    debt_limit_pyg?: number | null;
    account_status?: string | null;
  } | null;

  let pendingChargesPyg = 0;
  const pendingRows = chargesRes.error ? [] : (chargesRes.data ?? []);
  for (const row of pendingRows) {
    pendingChargesPyg += Math.max(0, Math.round(Number((row as { amount_pyg?: unknown }).amount_pyg ?? 0)));
  }

  const effective = pricingRow ? computeEffectivePricing(pricingRow) : null;
  const feePercent = effective?.driverFeePercentOfCollected ?? 10;
  // Fuente de verdad del default: pricing_settings (admin Billing/Pricing).
  // Si el conductor ya tiene cuenta, su debt_limit_pyg es el que aplica a suspensión.
  // Sin cuenta aún (típico antes del 1.er viaje), NO inventar 50.000: usar el default admin.
  const pricingDefault = effective?.driverDebtLimitDefault ?? DRIVER_DEBT_LIMIT_FALLBACK;
  const hasAccountLimit =
    acct != null && acct.debt_limit_pyg != null && Number.isFinite(Number(acct.debt_limit_pyg));
  const debtLimitPyg = hasAccountLimit
    ? normalizeDriverDebtLimit(acct.debt_limit_pyg)
    : pricingDefault;

  return {
    debtPyg: Math.max(0, Math.round(Number(acct?.debt_pyg ?? pendingChargesPyg))),
    debtLimitPyg,
    accountStatus: String(acct?.account_status ?? 'active'),
    pendingChargesCount: pendingRows.length,
    pendingChargesPyg,
    feePercent,
  };
}
