import { Platform } from 'react-native';

/** Inicio del día calendario local (00:00). */
export function startOfLocalDay(base: Date = new Date()): Date {
  const d = new Date(base.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Selector de fecha: Android ≥24 usa calendario material; iOS mantiene spinner pero con `minimumDate` en cada pantalla.
 */
export function datePickerDisplay(): 'calendar' | 'default' | 'spinner' {
  if (Platform.OS === 'android') {
    const v = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    return Number.isFinite(v) && v >= 24 ? 'calendar' : 'default';
  }
  return 'spinner';
}

/** Hora: reloj en Android; spinner en iOS (compact de hora a veces limita minutos). */
export function timePickerDisplay(): 'clock' | 'spinner' | 'default' {
  return Platform.OS === 'android' ? 'clock' : 'spinner';
}

export function clampDateNotBeforeLocalDay(picked: Date, minDay: Date): Date {
  const min = startOfLocalDay(minDay);
  const p = startOfLocalDay(picked);
  return p < min ? new Date(min) : picked;
}

/** YYYY-MM-DD en calendario local (no usar `toISOString().slice(0,10)` para fechas de UI). */
export function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
