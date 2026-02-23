/**
 * Tarifa por tramo (recogida → descenso) al 60% de la app de referencia.
 * Referencia: 13.900 PYG / 3 km; mínimo 11.900 PYG / 2 km.
 */

export const MIN_FARE_PYG = 7140; // 60% de 11.900
export const PYG_PER_KM = 2780;   // 60% de (13.900 / 3)

/** Precio base por 1 asiento según distancia del tramo (redondeado a 100). */
export function baseFareFromDistanceKm(distanceKm: number): number {
  const raw = Math.max(MIN_FARE_PYG, distanceKm * PYG_PER_KM);
  return Math.round(raw / 100) * 100;
}

/**
 * Total a cobrar según precio base (1 asiento) y cantidad de asientos.
 * - 1 asiento: base
 * - 2 a 4 asientos: base + 50% = 1,5 × base (ej. 15.000)
 * - 5 a 8 asientos: 2 × (1,5 × base) = 30.000 total 8 asientos
 * - 9 a 12 asientos: 3 × (1,5 × base) = 45.000 total 12 asientos
 * - y así cada bloque de 4 asientos suma 1,5 × base.
 * Fórmula: N=1 → base; N≥2 → ceil(N/4) × (1,5 × base). Redondeado a 100 PYG.
 */
export function totalFareFromBaseAndSeats(baseFare: number, seatCount: number): number {
  if (seatCount <= 0) return 0;
  if (seatCount === 1) return baseFare;
  const blockFare = Math.round((baseFare * 1.5) / 100) * 100; // 1 asiento + 50% = tarifa por bloque de hasta 4
  const blocks = Math.ceil(seatCount / 4);
  const total = blocks * blockFare;
  return Math.round(total / 100) * 100;
}
