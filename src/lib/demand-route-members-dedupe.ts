/**
 * demand_route_members puede traer filas duplicadas (mismo trip_request_id + stop_type).
 * Para UI y rutas: una sola fila por (pasajero, tipo de parada).
 */
export type DemandRouteMemberRow = {
  trip_request_id: string | null;
  stop_type: string | null;
  visit_order: number | null;
};

export function dedupeDemandRouteMemberRows<T extends DemandRouteMemberRow>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const m of rows) {
    const tid = String(m.trip_request_id ?? '');
    const raw = String(m.stop_type ?? 'LEGACY').trim().toUpperCase();
    const st = raw === 'PICKUP' || raw === 'DROPOFF' ? raw : 'LEGACY';
    const key = `${tid}|${st}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, m);
      continue;
    }
    const vo = Number(m.visit_order ?? 0);
    const pvo = Number(prev.visit_order ?? 0);
    if (st === 'PICKUP') {
      if (vo > 0 && pvo > 0) map.set(key, vo < pvo ? m : prev);
      else if (vo > 0) map.set(key, m);
      else if (pvo > 0) map.set(key, prev);
      else map.set(key, prev);
    } else if (st === 'DROPOFF') {
      map.set(key, vo > pvo ? m : prev);
    } else {
      map.set(key, prev);
    }
  }
  return Array.from(map.values());
}

/** Paradas finales (legs): un solo registro por pasajero + tipo; evita marcadores superpuestos en el mapa. */
export type DemandRouteLegDedupe = {
  trip_request_id: string;
  stop_type: string;
  visit_order: number;
};

export function dedupeDemandRouteLegsForUi<T extends DemandRouteLegDedupe>(legs: T[]): T[] {
  const map = new Map<string, T>();
  for (const leg of legs) {
    const tid = String(leg.trip_request_id ?? '');
    const raw = String(leg.stop_type ?? 'LEGACY').trim().toUpperCase();
    const st = raw === 'PICKUP' || raw === 'DROPOFF' ? raw : 'LEGACY';
    const key = st === 'LEGACY' ? `${tid}|LEGACY|${leg.visit_order}` : `${tid}|${st}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, leg);
      continue;
    }
    const vo = Number(leg.visit_order);
    const pvo = Number(prev.visit_order);
    if (st === 'PICKUP') {
      if (vo > 0 && pvo > 0) map.set(key, vo < pvo ? leg : prev);
      else if (vo > 0) map.set(key, leg);
      else if (pvo > 0) map.set(key, prev);
      else map.set(key, prev);
    } else if (st === 'DROPOFF') {
      map.set(key, vo > pvo ? leg : prev);
    } else {
      map.set(key, prev);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.visit_order - b.visit_order);
}
