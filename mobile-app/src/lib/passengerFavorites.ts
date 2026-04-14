/**
 * Favoritos del pasajero: trayectos frecuentes (origen -> destino), mismos campos que "Buscar viajes".
 * IDs: presets conocidos (iconos) o `custom_<timestamp>` para trayectos libres.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  /** Fecha puntual elegida cuando no es diario (YYYY-MM-DD). */
  scheduledDateYmd?: string;
  /** Hora elegida para recordatorio/recogida (HH:MM). */
  scheduledTimeHm?: string;
  /** Proxima ejecucion calculada localmente. */
  nextTriggerAtIso?: string;
  updatedAtIso: string;
};

export function isFavoriteEnabled(snap: PassengerFavoriteSnapshot | null | undefined): boolean {
  if (!snap) return false;
  return snap.enabled !== false;
}

export function computeNextTriggerIso(
  now: Date,
  dateYmd: string,
  timeHm: string,
  daily: boolean
): string | null {
  const [yy, mm, dd] = dateYmd.split('-').map((x) => parseInt(x, 10));
  const hmParts = timeHm.split(':');
  const h = parseInt(hmParts[0] ?? '', 10);
  const mi = parseInt(hmParts[1] ?? '', 10);
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) return null;
  const base = new Date(yy, mm - 1, dd, h, mi, 0, 0);
  if (Number.isNaN(base.getTime())) return null;
  if (!daily) return base.toISOString();
  /** Diario: primera ocurrencia en o después del día ancla `dateYmd`, y estrictamente después de `now`. */
  let candidate = new Date(base.getTime());
  while (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
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
    const computed = computeNextTriggerIso(now, d, t, true);
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
