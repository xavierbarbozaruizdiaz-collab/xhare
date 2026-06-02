/**
 * Filas en ride_stops: origen/destino publicados (is_base_stop true) vs ajustes de ruta (is_base_stop false).
 */
export type RideStopWithKind = {
  is_base_stop?: boolean | null;
};

export function isRouteAdjustmentStop(stop: RideStopWithKind): boolean {
  return stop.is_base_stop === false;
}

export function isOperationalDriverStop(stop: RideStopWithKind): boolean {
  return !isRouteAdjustmentStop(stop);
}

export function filterOperationalDriverStops<T extends RideStopWithKind>(stops: T[]): T[] {
  return stops.filter(isOperationalDriverStop);
}

export function nextOperationalStopArrayIndex<T extends RideStopWithKind>(
  sortedStops: T[],
  fromArrayIndex: number
): number {
  for (let i = fromArrayIndex + 1; i < sortedStops.length; i++) {
    if (!isRouteAdjustmentStop(sortedStops[i])) return i;
  }
  return sortedStops.length;
}
