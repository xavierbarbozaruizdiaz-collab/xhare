import type { SearchRouteEtaState } from '../components/SearchOriginDestinationMap';

export function parseYmdHm(dateYmd: string, hm: string): Date | null {
  const [yy, mm, dd] = dateYmd.trim().split('-').map((x) => parseInt(x, 10));
  const mt = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!mt) return null;
  const h = parseInt(mt[1], 10);
  const mi = parseInt(mt[2], 10);
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) return null;
  return new Date(yy, mm - 1, dd, h, mi, 0, 0);
}

export function formatHmFromDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function addMinutesToHm(dateYmd: string, fromHm: string, addMinutes: number): string | null {
  const dep = parseYmdHm(dateYmd, fromHm);
  if (!dep) return null;
  return formatHmFromDate(new Date(dep.getTime() + addMinutes * 60_000));
}

export function subtractMinutesFromHm(dateYmd: string, arrivalHm: string, subMinutes: number): string | null {
  const arr = parseYmdHm(dateYmd, arrivalHm);
  if (!arr) return null;
  return formatHmFromDate(new Date(arr.getTime() - subMinutes * 60_000));
}

/** Salida (`fromTimeHm`) + duración del mapa → hora aproximada en destino. */
export function formatEstimatedArrivalLine(
  dateYmd: string,
  fromTimeHm: string,
  routeEta: SearchRouteEtaState,
  hasOriginDestPins: boolean
): { text: string; isPlaceholder: boolean } {
  if (!hasOriginDestPins) {
    return { text: 'Marcá origen y destino en el mapa', isPlaceholder: true };
  }
  if (!dateYmd.trim() || !fromTimeHm.trim()) {
    return { text: 'Completá fecha y hora de salida para estimar la llegada', isPlaceholder: true };
  }
  if (routeEta.loading) {
    return { text: 'Calculando ruta…', isPlaceholder: true };
  }
  if (routeEta.durationMinutes == null) {
    return { text: 'No disponible (sin duración del trayecto)', isPlaceholder: true };
  }
  const [yy, mm, dd] = dateYmd.trim().split('-').map((x) => parseInt(x, 10));
  const [h, mi] = fromTimeHm.trim().split(':').map((x) => parseInt(x, 10));
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) {
    return { text: 'Fecha u hora no válida', isPlaceholder: true };
  }
  const dep = new Date(yy, mm - 1, dd, h, mi, 0, 0);
  const arr = new Date(dep.getTime() + routeEta.durationMinutes * 60_000);
  const hm = arr.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.round(routeEta.durationMinutes);
  return {
    text: `~${hm} en destino (${mins} min según la ruta del mapa)`,
    isPlaceholder: false,
  };
}

/** Modo favorito: llegada deseada → salida estimada restando la duración del mapa. */
export function formatEstimatedPickupLine(
  dateYmd: string,
  arrivalHm: string,
  routeEta: SearchRouteEtaState,
  hasOriginDestPins: boolean
): { text: string; isPlaceholder: boolean } {
  if (!hasOriginDestPins) {
    return { text: 'Marcá origen y destino en el mapa', isPlaceholder: true };
  }
  if (!dateYmd.trim() || !arrivalHm.trim()) {
    return { text: 'Completá fecha y hora de llegada deseada', isPlaceholder: true };
  }
  if (routeEta.loading) {
    return { text: 'Calculando ruta…', isPlaceholder: true };
  }
  if (routeEta.durationMinutes == null) {
    return { text: 'No disponible (sin duración del trayecto)', isPlaceholder: true };
  }
  const pickup = subtractMinutesFromHm(dateYmd, arrivalHm, routeEta.durationMinutes);
  if (!pickup) {
    return { text: 'Hora de llegada no válida', isPlaceholder: true };
  }
  const dep = parseYmdHm(dateYmd, pickup);
  if (!dep) {
    return { text: '—', isPlaceholder: true };
  }
  const hm = dep.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.round(routeEta.durationMinutes);
  return {
    text: `~${hm} salida estimada (${mins} min antes, según la ruta del mapa)`,
    isPlaceholder: false,
  };
}
