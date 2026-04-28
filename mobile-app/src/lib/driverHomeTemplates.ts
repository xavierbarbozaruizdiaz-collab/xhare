/**
 * Plantillas de publicación del conductor (Inicio): rutas reutilizables con nombre propio.
 * Persistencia local (AsyncStorage). Cada plantilla tiene un `id` opaco (sin “Casa/Trabajo”).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDaysToYmd, parseLocalYmdHm } from './bookingLead';
import {
  coerceScheduleWeekdayMask,
  computeNextTriggerIso,
  scheduleWeekdayMaskLabelEs,
} from './passengerFavorites';

const V1_PREFIX = '@xhare/driver_home_template_v1:';
const V2_PREFIX = '@xhare/driver_home_templates_v2:';

export type DriverHomeTemplateSnapshot = {
  /** Nombre que se muestra en Inicio y en `rides.route_name` al publicar. */
  tripDisplayName: string;
  /** Cupos ofrecidos en la publicación (≤ asientos del vehículo). */
  publishSeatCount: number;
  /** Meta de recaudación total (referencia en UI y en descripción del viaje). */
  totalCollectGs: number;
  /** Hora de salida habitual (HH:MM). */
  departureTimeHm: string;
  /** Fecha puntual cuando no es diario (YYYY-MM-DD). */
  departureDateYmd?: string;
  scheduleDaily?: boolean;
  scheduleWeekdayMask?: number;
  enabled?: boolean;
  rideKind?: 'internal' | 'long_distance';
  origin: string;
  destination: string;
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  nextTriggerAtIso?: string;
  /** Viaje vigente ligado a esta plantilla desde Inicio (apagar = intentar cancelar este id). */
  homeActiveRideId?: string | null;
  updatedAtIso: string;
};

export type DriverHomeTemplateRow = { id: string } & DriverHomeTemplateSnapshot;

type V2Store = { entries: DriverHomeTemplateRow[] };

function v2Key(userId: string): string {
  return `${V2_PREFIX}${userId}`;
}

export function newDriverTemplateId(): string {
  return `dt_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function isScheduleDailySnap(snap: DriverHomeTemplateSnapshot | undefined): boolean {
  if (!snap) return false;
  const v = snap.scheduleDaily as unknown;
  if (v === true) return true;
  if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  if (v === 1) return true;
  return false;
}

function isDriverTemplateEnabled(snap: DriverHomeTemplateSnapshot | undefined): boolean {
  if (!snap) return false;
  return snap.enabled !== false;
}

/** Paridad con favoritos pasajero: recalcula `nextTriggerAtIso` al abrir datos (diario + switch prendido). */
function alignDriverDailyNextTriggerFromAnchor(rows: DriverHomeTemplateRow[]): {
  rows: DriverHomeTemplateRow[];
  changed: boolean;
} {
  const now = new Date();
  let changed = false;
  const out = rows.map((row) => {
    const s = row;
    if (!isScheduleDailySnap(s) || !isDriverTemplateEnabled(s)) return row;
    const d = String(s.departureDateYmd ?? '').trim();
    const t = String(s.departureTimeHm ?? '').trim();
    if (!d || !t) return row;
    const maskC = coerceScheduleWeekdayMask(s.scheduleWeekdayMask);
    const computed = computeNextTriggerIso(now, d, t, true, maskC);
    if (!computed || s.nextTriggerAtIso === computed) return row;
    changed = true;
    return { ...row, nextTriggerAtIso: computed, updatedAtIso: new Date().toISOString() };
  });
  return { rows: out, changed };
}

export function driverTemplateHasConfig(snap: DriverHomeTemplateSnapshot | DriverHomeTemplateRow | undefined): boolean {
  if (!snap) return false;
  const o = typeof snap.origin === 'string' ? snap.origin.trim() : '';
  const d = typeof snap.destination === 'string' ? snap.destination.trim() : '';
  if (o && d) return true;
  return (
    snap.originLat != null &&
    snap.originLng != null &&
    snap.destinationLat != null &&
    snap.destinationLng != null
  );
}

export function driverScheduleLabel(snap: DriverHomeTemplateSnapshot | undefined): string {
  if (!snap) return 'Sin configurar';
  const baseDate = String(snap.departureDateYmd ?? '').trim();
  const hm = String(snap.departureTimeHm ?? '').trim() || '08:00';
  if (isScheduleDailySnap(snap)) {
    const nextIso = snap.nextTriggerAtIso?.trim();
    const nextText = nextIso
      ? new Date(nextIso).toLocaleDateString('es-PY', {
          day: '2-digit',
          month: '2-digit',
        })
      : 'próximo día';
    const maskLabel = scheduleWeekdayMaskLabelEs(snap.scheduleWeekdayMask);
    const daysPart =
      coerceScheduleWeekdayMask(snap.scheduleWeekdayMask) === 127 ? '' : ` · ${maskLabel}`;
    return `Diario ${hm} · próx. ${nextText}${daysPart}`;
  }
  return `Fecha ${baseDate || '--'} · salida ${hm}`;
}

async function readV2Store(userId: string): Promise<DriverHomeTemplateRow[]> {
  const raw = await AsyncStorage.getItem(v2Key(userId));
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as V2Store;
    return Array.isArray(p.entries) ? p.entries : [];
  } catch {
    return [];
  }
}

async function writeV2Store(userId: string, entries: DriverHomeTemplateRow[]): Promise<void> {
  await AsyncStorage.setItem(v2Key(userId), JSON.stringify({ entries }));
}

/**
 * Si existe guardado v1 (slots tipo home_to_work), migra a v2 una sola vez.
 */
async function ensureMigratedFromV1(userId: string): Promise<void> {
  const key2 = v2Key(userId);
  const hasV2 = (await AsyncStorage.getItem(key2)) != null;
  if (hasV2) return;

  const key1 = `${V1_PREFIX}${userId}`;
  const raw1 = await AsyncStorage.getItem(key1);
  const entries: DriverHomeTemplateRow[] = [];
  if (raw1) {
    try {
      const v1 = JSON.parse(raw1) as Record<string, DriverHomeTemplateSnapshot>;
      for (const snap of Object.values(v1)) {
        if (snap && typeof snap === 'object') {
          entries.push({ id: newDriverTemplateId(), ...snap });
        }
      }
    } catch {
      /* ignore */
    }
    await AsyncStorage.removeItem(key1);
  }
  await AsyncStorage.setItem(key2, JSON.stringify({ entries }));
}

export async function loadDriverHomeTemplateRows(userId: string): Promise<DriverHomeTemplateRow[]> {
  if (!userId) return [];
  await ensureMigratedFromV1(userId);
  let rows = await readV2Store(userId);
  const aligned = alignDriverDailyNextTriggerFromAnchor(rows);
  if (aligned.changed) {
    await writeV2Store(userId, aligned.rows);
    rows = aligned.rows;
  }
  return [...rows].sort((a, b) => (a.updatedAtIso < b.updatedAtIso ? 1 : -1));
}

export function getDriverHomeTemplateRow(
  rows: DriverHomeTemplateRow[],
  id: string
): DriverHomeTemplateRow | undefined {
  return rows.find((r) => r.id === id);
}

export type DriverHomeTemplateUpsertPatch = Partial<DriverHomeTemplateSnapshot> & {
  /** Antes de publicar desde Inicio: fecha puntual futura; o próxima ancla si es diario. */
  bumpScheduleAnchor?: boolean;
};

export async function upsertDriverHomeTemplateRow(
  userId: string,
  id: string,
  patch: DriverHomeTemplateUpsertPatch
): Promise<void> {
  if (!userId || !id) return;
  await ensureMigratedFromV1(userId);
  const rows = await readV2Store(userId);
  const idx = rows.findIndex((r) => r.id === id);
  const prev = idx >= 0 ? rows[idx] : undefined;

  const timeHm = String(patch.departureTimeHm ?? prev?.departureTimeHm ?? '08:00').trim();
  const daily = patch.scheduleDaily !== undefined ? Boolean(patch.scheduleDaily) : Boolean(prev?.scheduleDaily);
  const mask =
    patch.scheduleWeekdayMask !== undefined ? patch.scheduleWeekdayMask : prev?.scheduleWeekdayMask;
  const maskC = coerceScheduleWeekdayMask(mask);

  let anchorYmd = String(patch.departureDateYmd ?? prev?.departureDateYmd ?? toYmdLocal(new Date())).trim();
  if (patch.bumpScheduleAnchor) {
    if (daily) {
      const nextIso = computeNextTriggerIso(new Date(), anchorYmd, timeHm, true, maskC);
      if (nextIso) anchorYmd = toYmdLocal(new Date(nextIso));
    } else {
      for (let g = 0; g < 400; g++) {
        const t = parseLocalYmdHm(anchorYmd, timeHm);
        if (!t || t.getTime() > Date.now()) break;
        anchorYmd = addDaysToYmd(anchorYmd, 1);
      }
    }
  }

  const outDateYmd = patch.bumpScheduleAnchor
    ? anchorYmd
    : String(patch.departureDateYmd ?? prev?.departureDateYmd ?? toYmdLocal(new Date())).trim();

  const scheduleChanged =
    Boolean(patch.bumpScheduleAnchor) ||
    patch.departureDateYmd !== undefined ||
    patch.departureTimeHm !== undefined ||
    patch.scheduleDaily !== undefined ||
    patch.scheduleWeekdayMask !== undefined;
  const nextTrigger = scheduleChanged
    ? computeNextTriggerIso(new Date(), outDateYmd, timeHm, daily, maskC)
    : prev?.nextTriggerAtIso;

  const merged: DriverHomeTemplateSnapshot = {
    tripDisplayName: String(patch.tripDisplayName ?? prev?.tripDisplayName ?? '').trim(),
    publishSeatCount: Math.max(
      1,
      Math.floor(Number(patch.publishSeatCount ?? prev?.publishSeatCount ?? 4) || 4)
    ),
    totalCollectGs: Math.max(
      0,
      Math.round(Number(patch.totalCollectGs ?? prev?.totalCollectGs ?? 0) || 0)
    ),
    departureTimeHm: timeHm,
    departureDateYmd: outDateYmd,
    scheduleDaily: patch.scheduleDaily !== undefined ? patch.scheduleDaily : prev?.scheduleDaily,
    scheduleWeekdayMask: patch.scheduleWeekdayMask !== undefined ? patch.scheduleWeekdayMask : prev?.scheduleWeekdayMask,
    enabled: patch.enabled !== undefined ? patch.enabled : prev?.enabled,
    rideKind: patch.rideKind ?? prev?.rideKind ?? 'internal',
    origin: String(patch.origin ?? prev?.origin ?? ''),
    destination: String(patch.destination ?? prev?.destination ?? ''),
    originLat: patch.originLat !== undefined ? patch.originLat : prev?.originLat ?? null,
    originLng: patch.originLng !== undefined ? patch.originLng : prev?.originLng ?? null,
    destinationLat:
      patch.destinationLat !== undefined ? patch.destinationLat : prev?.destinationLat ?? null,
    destinationLng:
      patch.destinationLng !== undefined ? patch.destinationLng : prev?.destinationLng ?? null,
    nextTriggerAtIso: nextTrigger ?? undefined,
    homeActiveRideId:
      patch.homeActiveRideId !== undefined ? patch.homeActiveRideId : prev?.homeActiveRideId ?? undefined,
    updatedAtIso: new Date().toISOString(),
  };

  const row: DriverHomeTemplateRow = { id, ...merged };
  const next =
    idx >= 0 ? rows.map((r, i) => (i === idx ? row : r)) : [...rows, row];
  await writeV2Store(userId, next);
}

export async function removeDriverHomeTemplateRow(userId: string, id: string): Promise<void> {
  if (!userId || !id) return;
  await ensureMigratedFromV1(userId);
  const rows = (await readV2Store(userId)).filter((r) => r.id !== id);
  await writeV2Store(userId, rows);
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
