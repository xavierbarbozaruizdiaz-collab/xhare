/**
 * Vehículos conocidos: al ingresar marca y modelo se sugiere cantidad de asientos
 * y distribución. Si hay más de una opción, el conductor solo confirma cuál es.
 */

export type VehiclePreset = {
  make: string;
  model: string;
  /** Nombre para mostrar (ej. "Hyundai County") */
  label: string;
  seats: number;
  /** Opciones de distribución típicas; si solo hay una, se aplica automático */
  layouts: { rows: number[]; label: string }[];
};

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Lista de vehículos con asientos y distribuciones típicas (buses, vans, combis). */
export const VEHICLE_PRESETS: VehiclePreset[] = [
  { make: 'hyundai', model: 'county', label: 'Hyundai County', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }, { rows: [2, 2, 2, 2, 2, 2, 2], label: '2-2-2-2-2-2-2 (14 asientos)' }] },
  { make: 'hyundai', model: 'county', label: 'Hyundai County', seats: 22, layouts: [{ rows: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], label: '2-2 por fila (22 asientos)' }] },
  { make: 'mercedes', model: 'sprinter', label: 'Mercedes Sprinter', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }, { rows: [2, 3, 3, 3, 2], label: '2-3-3-3-2 (13 asientos)' }] },
  { make: 'mercedes', model: 'sprinter', label: 'Mercedes Sprinter', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'toyota', model: 'hiace', label: 'Toyota Hiace', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }, { rows: [2, 3, 3, 3, 2], label: '2-3-3-3-2 (13 asientos)' }] },
  { make: 'toyota', model: 'hiace', label: 'Toyota Hiace', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'nissan', model: 'urvan', label: 'Nissan Urvan', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }] },
  { make: 'volkswagen', model: 'transporter', label: 'Volkswagen Transporter', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'volkswagen', model: 'kombi', label: 'Volkswagen Kombi', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'fiat', model: 'ducato', label: 'Fiat Ducato', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'fiat', model: 'ducato', label: 'Fiat Ducato', seats: 12, layouts: [{ rows: [3, 3, 3, 3], label: '3-3-3-3 (12 asientos)' }] },
  { make: 'peugeot', model: 'boxer', label: 'Peugeot Boxer', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'renault', model: 'master', label: 'Renault Master', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'iveco', model: 'daily', label: 'Iveco Daily', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }] },
  { make: 'mitsubishi', model: 'l300', label: 'Mitsubishi L300', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'kia', model: 'bongo', label: 'Kia Bongo', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'ford', model: 'transit', label: 'Ford Transit', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }] },
  { make: 'ford', model: 'transit', label: 'Ford Transit', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'chevrolet', model: 'n300', label: 'Chevrolet N300', seats: 9, layouts: [{ rows: [3, 3, 3], label: '3-3-3 (9 asientos)' }] },
  { make: 'dodge', model: 'ram', label: 'Dodge Ram Van', seats: 15, layouts: [{ rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' }] },
];

/**
 * Busca presets por marca y modelo (normalizados).
 * Devuelve todos los que coincidan (pueden ser varias configuraciones del mismo modelo).
 */
export function findVehiclePresets(make: string, model: string): VehiclePreset[] {
  const m = normalize(make);
  const mod = normalize(model);
  if (!m || !mod) return [];
  return VEHICLE_PRESETS.filter(
    (v) => v.make.includes(m) || m.includes(v.make),
  ).filter(
    (v) => v.model.includes(mod) || mod.includes(v.model),
  );
}

/**
 * Si solo hay un preset o varios con la misma configuración, devuelve ese.
 * Si hay varios con distintas configs, devuelve todos para que el usuario elija.
 */
export function getSuggestedPresets(make: string, model: string): VehiclePreset[] {
  return findVehiclePresets(make, model);
}
