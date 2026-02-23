/**
 * Distribución de asientos tipo aerolínea (filas con N asientos cada una).
 * rows: [2, 2, 3] = fila 1: 2 asientos (1A, 1B), fila 2: 2 (2A, 2B), fila 3: 3 (3A, 3B, 3C).
 */

export type SeatLayout = { rows: number[] };

const ROW_LABELS = 'ABCDEFGHIJ';

/** Genera IDs de asientos a partir de rows: ["1A","1B","2A","2B","3A","3B","3C"] */
export function buildSeatIdsFromRows(rows: number[]): string[] {
  const ids: string[] = [];
  rows.forEach((count, rowIndex) => {
    const rowNum = rowIndex + 1;
    for (let i = 0; i < count; i++) {
      ids.push(`${rowNum}${ROW_LABELS[i]}`);
    }
  });
  return ids;
}

/** Presets por cantidad de asientos (2-15). Cada uno tiene rows y una etiqueta. */
export const SEAT_LAYOUT_PRESETS: { seats: number; rows: number[]; label: string }[] = [
  { seats: 2, rows: [2], label: '2 asientos (1 fila)' },
  { seats: 3, rows: [3], label: '3 asientos (1 fila)' },
  { seats: 4, rows: [2, 2], label: '2-2 (4 asientos)' },
  { seats: 5, rows: [2, 3], label: '2-3 (5 asientos)' },
  { seats: 5, rows: [3, 2], label: '3-2 (5 asientos)' },
  { seats: 6, rows: [2, 2, 2], label: '2-2-2 (6 asientos)' },
  { seats: 6, rows: [3, 3], label: '3-3 (6 asientos)' },
  { seats: 7, rows: [2, 3, 2], label: '2-3-2 (7 asientos)' },
  { seats: 8, rows: [2, 2, 2, 2], label: '2-2-2-2 (8 asientos)' },
  { seats: 8, rows: [2, 3, 3], label: '2-3-3 (8 asientos)' },
  { seats: 9, rows: [3, 3, 3], label: '3-3-3 (9 asientos)' },
  { seats: 10, rows: [2, 2, 3, 3], label: '2-2-3-3 (10 asientos)' },
  { seats: 10, rows: [2, 3, 2, 3], label: '2-3-2-3 (10 asientos)' },
  { seats: 11, rows: [2, 3, 3, 3], label: '2-3-3-3 (11 asientos)' },
  { seats: 12, rows: [3, 3, 3, 3], label: '3-3-3-3 (12 asientos)' },
  { seats: 12, rows: [2, 2, 2, 2, 2, 2], label: '2-2-2-2-2-2 (12 asientos)' },
  { seats: 13, rows: [2, 3, 3, 3, 2], label: '2-3-3-3-2 (13 asientos)' },
  { seats: 14, rows: [2, 2, 3, 3, 2, 2], label: '2-2-3-3-2-2 (14 asientos)' },
  { seats: 15, rows: [3, 3, 3, 3, 3], label: '3-3-3-3-3 (15 asientos)' },
];

/** Opciones de cantidad de asientos para el dropdown (6 a 50). */
export const SEAT_COUNT_OPTIONS = Array.from({ length: 45 }, (_, i) => i + 6);

/** Presets filtrados por cantidad de asientos. */
export function getPresetsForSeatCount(seatCount: number): { rows: number[]; label: string }[] {
  return SEAT_LAYOUT_PRESETS
    .filter((p) => p.seats === seatCount)
    .map(({ rows, label }) => ({ rows, label }));
}

/** Layout por defecto cuando no hay preset: una sola fila. */
export function defaultLayoutForSeatCount(seatCount: number): SeatLayout {
  return { rows: [seatCount] };
}

/** Parsea layout desde DB (profiles.vehicle_seat_layout o rides.seat_layout). */
export function parseSeatLayout(value: unknown): SeatLayout | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'number' || r < 1 || r > 5)) return null;
  return { rows };
}
