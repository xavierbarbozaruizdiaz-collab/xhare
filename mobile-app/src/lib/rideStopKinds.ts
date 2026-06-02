/**
 * Filas en ride_stops: origen/destino publicados (is_base_stop true) vs ajustes de ruta al publicar
 * (is_base_stop false — solo moldean el trazado guardado en base_route_polyline vía Google Routes).
 */
export type RideStopWithKind = {
  is_base_stop?: boolean | null;
};

/** Punto intermedio cargado solo para modificar el trazado; no es visita operativa. */
export function isRouteAdjustmentStop(stop: RideStopWithKind): boolean {
  return stop.is_base_stop === false;
}

/** Paradas del conductor que pueden figurar en recorrido / llegada (origen y destino publicados). */
export function isOperationalDriverStop(stop: RideStopWithKind): boolean {
  return !isRouteAdjustmentStop(stop);
}

export function filterOperationalDriverStops<T extends RideStopWithKind>(stops: T[]): T[] {
  return stops.filter(isOperationalDriverStop);
}

export function filterRouteAdjustmentStops<T extends RideStopWithKind>(stops: T[]): T[] {
  return stops.filter(isRouteAdjustmentStop);
}

/** Siguiente índice en ride_stops ordenado, saltando ajustes de ruta (solo geometría). */
export function nextOperationalStopArrayIndex<T extends RideStopWithKind>(
  sortedStops: T[],
  fromArrayIndex: number
): number {
  for (let i = fromArrayIndex + 1; i < sortedStops.length; i++) {
    if (!isRouteAdjustmentStop(sortedStops[i])) return i;
  }
  return sortedStops.length;
}
