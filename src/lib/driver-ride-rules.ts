/**
 * Reglas conductor ↔ viaje (inicio y cancelación). Mantener alineado con
 * `mobile-app/src/constants/driverRideRules.ts` y con el trigger en
 * `097_driver_compliance_no_show.sql` (ventana en_route).
 */
export const DRIVER_START_WINDOW_MINUTES = 5;
export const DRIVER_CANCEL_MIN_HOURS_BEFORE = 1;
/** Ocupación = asientos ocupados / total; si &lt; esto, puede cancelar con antelación suficiente. */
export const DRIVER_CANCEL_MAX_EMPTY_FRACTION = 0.5;

export type RuleOk = { ok: true };
export type RuleErr = { ok: false; code: string; details: string };
export type RuleResult = RuleOk | RuleErr;

export function checkDriverMayStartEnRoute(
  departureTimeIso: string | null | undefined,
  nowMs: number = Date.now()
): RuleResult {
  if (departureTimeIso == null || String(departureTimeIso).trim() === '') {
    return {
      ok: false,
      code: 'no_departure_time',
      details: 'Este viaje no tiene hora de salida definida. No se puede iniciar.',
    };
  }
  const dep = Date.parse(String(departureTimeIso));
  if (Number.isNaN(dep)) {
    return { ok: false, code: 'invalid_departure_time', details: 'La fecha de salida no es válida.' };
  }
  const earliest = dep - DRIVER_START_WINDOW_MINUTES * 60_000;
  if (nowMs < earliest) {
    return {
      ok: false,
      code: 'start_too_early',
      details: `Podés iniciar el viaje solo desde ${DRIVER_START_WINDOW_MINUTES} minutos antes de la hora de salida programada.`,
    };
  }
  if (nowMs > dep) {
    return {
      ok: false,
      code: 'start_too_late',
      details: 'Ya pasó la hora de salida programada. No podés iniciar el viaje.',
    };
  }
  return { ok: true };
}

/**
 * Asientos ocupados: total - disponibles (clamp 0..total).
 */
export function occupiedSeatsFromRide(totalSeats: number | null | undefined, availableSeats: number | null | undefined): number {
  const total = Math.max(0, totalSeats ?? 0);
  const avail = Math.max(0, Math.min(total, availableSeats ?? 0));
  return Math.max(0, total - avail);
}

export function occupancyFraction(totalSeats: number | null | undefined, availableSeats: number | null | undefined): number {
  const total = Math.max(0, totalSeats ?? 0);
  if (total <= 0) return 0;
  return occupiedSeatsFromRide(total, availableSeats) / total;
}

/**
 * Cancelación por conductor (viajes published/booked → cancelled o equivalente):
 * - Con ocupación ≥ 50%: no se puede cancelar desde la app (emergencia → soporte).
 * - Con ocupación &lt; 50%: hace falta al menos 1 h antes de la salida.
 */
export function checkDriverMayCancelPublishedOrBooked(
  departureTimeIso: string | null | undefined,
  totalSeats: number | null | undefined,
  availableSeats: number | null | undefined,
  nowMs: number = Date.now()
): RuleResult {
  if (departureTimeIso == null || String(departureTimeIso).trim() === '') {
    return { ok: false, code: 'no_departure_time', details: 'No se puede cancelar: falta hora de salida.' };
  }
  const dep = Date.parse(String(departureTimeIso));
  if (Number.isNaN(dep)) {
    return { ok: false, code: 'invalid_departure_time', details: 'La fecha de salida no es válida.' };
  }
  const occ = occupancyFraction(totalSeats, availableSeats);
  const oneHourMs = DRIVER_CANCEL_MIN_HOURS_BEFORE * 60 * 60_000;
  const msUntilDep = dep - nowMs;

  if (occ >= DRIVER_CANCEL_MAX_EMPTY_FRACTION) {
    return {
      ok: false,
      code: 'cancel_high_occupancy',
      details:
        'Con el vehículo ocupado en un 50% o más no podés cancelar desde la app. Contactá a soporte si es una emergencia.',
    };
  }
  if (msUntilDep < oneHourMs) {
    return {
      ok: false,
      code: 'cancel_too_late_low_fill',
      details:
        'Con menos del 50% de ocupación igual necesitás cancelar con al menos 1 hora de antelación para dar tiempo a los pasajeros.',
    };
  }
  return { ok: true };
}

export type DriverAccountGate = {
  account_status: string | null;
  operational_blocked_until: string | null;
  debt_pyg?: number | null;
  debt_limit_pyg?: number | null;
};

export function checkDriverAccountAllowsOperation(account: DriverAccountGate | null | undefined, nowMs: number = Date.now()): RuleResult {
  const opUntil = account?.operational_blocked_until ? Date.parse(String(account.operational_blocked_until)) : NaN;
  if (!Number.isNaN(opUntil) && opUntil > nowMs) {
    return {
      ok: false,
      code: 'operational_blocked',
      details:
        'Tu cuenta tiene una restricción temporal por incumplimiento de viaje programado. Si es un error, contactá a soporte.',
    };
  }
  if (account?.account_status === 'suspended') {
    return {
      ok: false,
      code: 'account_suspended',
      details: 'Tu cuenta está suspendida por deuda pendiente. Contactá a soporte para regularizar.',
    };
  }
  return { ok: true };
}
