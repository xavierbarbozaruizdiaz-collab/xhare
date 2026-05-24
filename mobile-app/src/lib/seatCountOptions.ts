/** Cantidad de asientos del vehículo (6–50), alineado con web `SEAT_COUNT_OPTIONS`. */
export const SEAT_COUNT_MIN = 6;
export const SEAT_COUNT_MAX = 50;

export const SEAT_COUNT_OPTIONS = Array.from(
  { length: SEAT_COUNT_MAX - SEAT_COUNT_MIN + 1 },
  (_, i) => i + SEAT_COUNT_MIN
);
