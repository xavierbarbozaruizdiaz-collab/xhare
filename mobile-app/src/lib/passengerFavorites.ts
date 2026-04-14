/**
 * Favoritos del pasajero: trayectos frecuentes (origen -> destino), mismos campos que "Buscar viajes".
 * IDs: presets conocidos (iconos) o `custom_<timestamp>` para trayectos libres.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseLocalYmdHm } from './bookingLead';

const PREFIX = '@xhare/passenger_favorite_v2:';

/** Cualquier clave guardada en el store (preset o custom_...). */
export type PassengerFavoriteSlot = string;

export type FavoritePreset = {
  id: PassengerFavoriteSlot;
  from: string;
  to: string;
  /** Texto para accesibilidad y filas del Inicio (no hace falta en el modal solo-iconos). */
  label: string;
};

/**
 * Catálogo ampliable: solo define pares de iconos; el modal muestra scroll sin texto largo.
 */
export const FAVORITE_PRESETS: readonly FavoritePreset[] = [
  { id: 'home_to_work', from: 'home-outline', to: 'briefcase-outline', label: 'Casa -> Trabajo' },
  { id: 'work_to_gym', from: 'briefcase-outline', to: 'barbell-outline', label: 'Trabajo -> Gym' },
  { id: 'gym_to_home', from: 'barbell-outline', to: 'home-outline', label: 'Gym -> Casa' },
  { id: 'work_to_home', from: 'briefcase-outline', to: 'home-outline', label: 'Trabajo -> Casa' },
  { id: 'home_to_gym', from: 'home-outline', to: 'barbell-outline', label: 'Casa -> Gym' },
  { id: 'gym_to_work', from: 'barbell-outline', to: 'briefcase-outline', label: 'Gym -> Trabajo' },
  { id: 'home_to_school', from: 'home-outline', to: 'school-outline', label: 'Casa -> Estudio' },
  { id: 'school_to_home', from: 'school-outline', to: 'home-outline', label: 'Estudio -> Casa' },
  { id: 'work_to_airport', from: 'briefcase-outline', to: 'airplane-outline', label: 'Trabajo -> Aeropuerto' },
  { id: 'airport_to_home', from: 'airplane-outline', to: 'home-outline', label: 'Aeropuerto -> Casa' },
  { id: 'home_to_hospital', from: 'home-outline', to: 'medical-outline', label: 'Casa -> Salud' },
  { id: 'hospital_to_home', from: 'medical-outline', to: 'home-outline', label: 'Salud -> Casa' },
  { id: 'work_to_restaurant', from: 'briefcase-outline', to: 'restaurant-outline', label: 'Trabajo -> Comer' },
  { id: 'home_to_store', from: 'home-outline', to: 'cart-outline', label: 'Casa -> Compras' },
  { id: 'store_to_home', from: 'cart-outline', to: 'home-outline', label: 'Compras -> Casa' },
  { id: 'home_to_bus', from: 'home-outline', to: 'bus-outline', label: 'Casa -> Bus' },
  { id: 'bus_to_work', from: 'bus-outline', to: 'briefcase-outline', label: 'Bus -> Trabajo' },
  { id: 'car_to_work', from: 'car-outline', to: 'briefcase-outline', label: 'Auto -> Trabajo' },
  { id: 'work_to_car', from: 'briefcase-outline', to: 'car-outline', label: 'Trabajo -> Auto' },
  { id: 'cafe_to_work', from: 'cafe-outline', to: 'briefcase-outline', label: 'Cafe -> Trabajo' },
  { id: 'work_to_cafe', from: 'briefcase-outline', to: 'cafe-outline', label: 'Trabajo -> Cafe' },
  { id: 'library_to_home', from: 'library-outline', to: 'home-outline', label: 'Biblioteca -> Casa' },
  { id: 'home_to_library', from: 'home-outline', to: 'library-outline', label: 'Casa -> Biblioteca' },
] as const;

const PRESET_BY_ID = new Map<string, FavoritePreset>(FAVORITE_PRESETS.map((p) => [p.id, p]));

export function getFavoritePreset(id: string): FavoritePreset | undefined {
  return PRESET_BY_ID.get(id);
}

/**
 * Resuelve el id del preset por par de iconos Ionicons (mismo criterio que `FAVORITE_PRESETS`).
 * Usado por el modal de Inicio al combinar origen/destino.
 */
export function findFavoritePresetIdByIcons(from: string, to: string): PassengerFavoriteSlot | null {
  const hit = FAVORITE_PRESETS.find((p) => p.from === from && p.to === to);
  return hit ? hit.id : null;
}

/** IDs en orden del catálogo (Inicio y modal de presets). */
export const FAVORITE_PRESET_IDS: PassengerFavoriteSlot[] = FAVORITE_PRESETS.map((p) => p.id);

export function isCustomFavoriteSlot(id: string): boolean {
  return id.startsWith('custom_');
}

export function favoritePairLabel(id: string): string {
  return getFavoritePreset(id)?.label ?? 'Trayecto personalizado';
}

export type PassengerFavoriteSnapshot = {
  date: string;
  fromTime: string;
  routeNameQuery: string;
  origin: string;
  destination: string;
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  rideKind: 'all' | 'internal' | 'long_distance';
  /** Activado para uso rapido (switch en Inicio). */
  enabled?: boolean;
  /** Si es true, corre todos los dias a la misma hora. */
  scheduleDaily?: boolean;
  /**
   * Con `scheduleDaily`: qué días de la semana aplica (calendario local).
   * Bits 0=domingo … 6=sábado (igual que `Date.getDay()`). 127 = los 7 días.
   */
  scheduleWeekdayMask?: number;
  /** Fecha puntual elegida cuando no es diario (YYYY-MM-DD). */
  scheduledDateYmd?: string;
  /** Hora elegida para recordatorio/recogida (HH:MM). */
  scheduledTimeHm?: string;
  /**
   * Si el pasajero configuró por “llegada al destino”, hora de llegada deseada (HH:MM).
   * La recogida sigue en `scheduledTimeHm` / `fromTime`.
   */
  scheduledArrivalTimeHm?: string;
  /** Proxima ejecucion calculada localmente. */
  nextTriggerAtIso?: string;
  updatedAtIso: string;
};

export function isFavoriteEnabled(snap: PassengerFavoriteSnapshot | null | undefined): boolean {
  if (!snap) return false;
  return snap.enabled !== false;
}

/** 127 = domingo(1) + … + sábado(64), mismo orden que `Date.getDay()`. */
export const SCHEDULE_WEEKDAY_MASK_ALL = 127;

/** Lee la máscara (0–127). Ausente o inválido = los 7 días (retrocompat). */
export function coerceScheduleWeekdayMask(mask: unknown): number {
  if (typeof mask === 'number' && Number.isFinite(mask)) return Math.floor(mask) & 127;
  if (typeof mask === 'string' && /^\d{1,3}$/.test(mask.trim())) {
    return coerceScheduleWeekdayMask(parseInt(mask.trim(), 10));
  }
  return SCHEDULE_WEEKDAY_MASK_ALL;
}

export function isJsWeekdayInScheduleMask(jsWeekday0Sun6Sat: number, mask: number): boolean {
  const m = coerceScheduleWeekdayMask(mask);
  if (m === 0) return false;
  const d = ((jsWeekday0Sun6Sat % 7) + 7) % 7;
  return ((m >> d) & 1) === 1;
}

const WEEKDAY_SHORT_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

/** Texto corto para UI (Inicio / admin). */
export function scheduleWeekdayMaskLabelEs(mask: unknown): string {
  const m = coerceScheduleWeekdayMask(mask);
  if (m === 0) return 'sin días';
  if (m === SCHEDULE_WEEKDAY_MASK_ALL) return 'todos los días';
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    if ((m >> i) & 1) parts.push(WEEKDAY_SHORT_ES[i]!);
  }
  return parts.join(', ');
}

export function computeNextTriggerIso(
  now: Date,
  dateYmd: string,
  timeHm: string,
  daily: boolean,
  /** Solo diario: bitmask de días (ver `scheduleWeekdayMask`). Ausente = los 7 días. */
  weekdayMask?: number
): string | null {
  const [yy, mm, dd] = dateYmd.split('-').map((x) => parseInt(x, 10));
  const hmParts = timeHm.split(':');
  const h = parseInt(hmParts[0] ?? '', 10);
  const mi = parseInt(hmParts[1] ?? '', 10);
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) return null;
  const base = new Date(yy, mm - 1, dd, h, mi, 0, 0);
  if (Number.isNaN(base.getTime())) return null;
  if (!daily) return base.toISOString();
  const mask =
    weekdayMask === undefined || weekdayMask === null ? SCHEDULE_WEEKDAY_MASK_ALL : coerceScheduleWeekdayMask(weekdayMask);
  if (mask === 0) return null;
  /** Diario: primera instancia ≥ ancla, > ahora, en un día permitido por la máscara. */
  let candidate = new Date(base.getTime());
  for (let guard = 0; guard < 400; guard++) {
    const okTime = candidate.getTime() > now.getTime();
    const wd = candidate.getDay();
    const okDay = ((mask >> wd) & 1) === 1;
    if (okTime && okDay) return candidate.toISOString();
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(h, mi, 0, 0);
  }
  return null;
}

type Store = Partial<Record<string, PassengerFavoriteSnapshot>>;

function storageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/**
 * Inicio solo muestra `home_to_work` y `work_to_home`. Los favoritos guardados como `custom_*`
 * quedaban invisibles; al cargar los reasignamos a esos slots vacíos (por fecha de actualización).
 */
function migrateCustomFavoritesIntoFixedSlots(store: Store): { next: Store; changed: boolean } {
  const customs = Object.keys(store).filter((k) => isCustomFavoriteSlot(k));
  if (customs.length === 0) return { next: store, changed: false };

  const next: Store = { ...store };
  let changed = false;

  const sorted = customs
    .map((k) => ({ k, snap: next[k] }))
    .filter((x): x is { k: string; snap: PassengerFavoriteSnapshot } => Boolean(x.snap))
    .sort(
      (a, b) =>
        new Date(b.snap.updatedAtIso).getTime() - new Date(a.snap.updatedAtIso).getTime()
    );

  for (const { k, snap } of sorted) {
    if (!next.home_to_work) {
      next.home_to_work = snap;
      delete next[k];
      changed = true;
    } else if (!next.work_to_home) {
      next.work_to_home = snap;
      delete next[k];
      changed = true;
    }
  }

  const remaining = Object.keys(next).filter((k) => isCustomFavoriteSlot(k));
  if (remaining.length > 0 && next.home_to_work && next.work_to_home) {
    for (const k of remaining) {
      delete next[k];
      changed = true;
    }
  }

  return { next, changed };
}

function normalizeSnapshotBooleans(snap: PassengerFavoriteSnapshot): PassengerFavoriteSnapshot {
  const sd = snap.scheduleDaily as unknown;
  if (sd === 'true' || sd === 1 || sd === '1') return { ...snap, scheduleDaily: true };
  if (sd === 'false' || sd === 0 || sd === '0') return { ...snap, scheduleDaily: false };
  return snap;
}

function normalizeStoreBooleans(store: Store): { next: Store; changed: boolean } {
  let changed = false;
  const next: Store = { ...store };
  for (const k of Object.keys(next)) {
    const s = next[k];
    if (!s) continue;
    const n = normalizeSnapshotBooleans(s);
    if (n.scheduleDaily !== s.scheduleDaily) {
      next[k] = n;
      changed = true;
    }
  }
  return { next, changed };
}

/** Favorito de una sola fecha/hora: si ya pasó la salida/recogida, apaga el switch. */
function applyOneOffAutoDisableIfPast(store: Store, now: Date): { next: Store; changed: boolean } {
  let changed = false;
  const next: Store = { ...store };
  for (const k of Object.keys(next)) {
    const s = next[k];
    if (!s || !isFavoriteEnabled(s)) continue;
    if (normalizeSnapshotBooleans(s).scheduleDaily) continue;
    const d = (s.scheduledDateYmd ?? s.date ?? '').trim();
    const t = (s.scheduledTimeHm ?? s.fromTime ?? '').trim();
    if (!d || !t) continue;
    const end = parseLocalYmdHm(d, t);
    if (!end || end.getTime() > now.getTime()) continue;
    next[k] = { ...s, enabled: false };
    changed = true;
  }
  return { next, changed };
}

/** Corrige `nextTriggerAtIso` guardado con la lógica antigua (diario ignoraba la fecha ancla). */
function alignDailyNextTriggerFromAnchor(store: Store): { next: Store; changed: boolean } {
  const now = new Date();
  let changed = false;
  const next: Store = { ...store };
  for (const k of Object.keys(next)) {
    const s = next[k];
    if (!s || !normalizeSnapshotBooleans(s).scheduleDaily || !isFavoriteEnabled(s)) continue;
    const d = (s.scheduledDateYmd ?? s.date ?? '').trim();
    const t = (s.scheduledTimeHm ?? s.fromTime ?? '').trim();
    if (!d || !t) continue;
    const computed = computeNextTriggerIso(now, d, t, true, s.scheduleWeekdayMask);
    if (!computed || s.nextTriggerAtIso === computed) continue;
    next[k] = { ...s, nextTriggerAtIso: computed };
    changed = true;
  }
  return { next, changed };
}

export async function loadPassengerFavorites(userId: string): Promise<Store> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return {};
  let store: Store;
  try {
    const parsed = JSON.parse(raw) as Store;
    store = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
  let { next, changed } = migrateCustomFavoritesIntoFixedSlots(store);
  const norm = normalizeStoreBooleans(next);
  next = norm.next;
  changed = changed || norm.changed;
  const expired = applyOneOffAutoDisableIfPast(next, new Date());
  next = expired.next;
  changed = changed || expired.changed;
  const aligned = alignDailyNextTriggerFromAnchor(next);
  next = aligned.next;
  changed = changed || aligned.changed;
  if (changed) {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  }
  return next;
}

export async function getPassengerFavorite(
  userId: string,
  slot: PassengerFavoriteSlot
): Promise<PassengerFavoriteSnapshot | null> {
  const all = await loadPassengerFavorites(userId);
  return all[slot] ?? null;
}

export async function upsertPassengerFavorite(
  userId: string,
  slot: PassengerFavoriteSlot,
  snap: Omit<PassengerFavoriteSnapshot, 'updatedAtIso'>
): Promise<void> {
  const all = await loadPassengerFavorites(userId);
  const next: PassengerFavoriteSnapshot = {
    ...snap,
    updatedAtIso: new Date().toISOString(),
  };
  all[slot] = next;
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(all));
}

export async function removePassengerFavorite(userId: string, slot: PassengerFavoriteSlot): Promise<void> {
  const all = await loadPassengerFavorites(userId);
  if (!(slot in all)) return;
  delete all[slot];
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(all));
}

/** Orden del Inicio: todos los presets, luego custom guardados (mas reciente primero). */
export function listHomeFavoriteSlotIds(store: Store): PassengerFavoriteSlot[] {
  const custom = Object.keys(store).filter((k) => isCustomFavoriteSlot(k));
  custom.sort((a, b) => {
    const ta = Number(a.replace('custom_', '')) || 0;
    const tb = Number(b.replace('custom_', '')) || 0;
    return tb - ta;
  });
  return [...FAVORITE_PRESET_IDS, ...custom];
}
