/**
 * demand_route_members puede traer filas duplicadas (mismo trip_request_id + stop_type).
 * Misma lógica que `src/lib/demand-route-members-dedupe.ts` en el repo Next (Metro no importa ese path).
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

/** Orden canónico de paradas (visit_order + desempates); alineado con `src/lib/demand-route-members-dedupe.ts`. */
export function compareDemandRouteLegsStable<T extends DemandRouteLegDedupe>(a: T, b: T): number {
  const vo = Number(a.visit_order) - Number(b.visit_order);
  if (vo !== 0) return vo;
  const id = String(a.trip_request_id).localeCompare(String(b.trip_request_id));
  if (id !== 0) return id;
  return String(a.stop_type).localeCompare(String(b.stop_type));
}

export function dedupeDemandRouteLegsForUi<T extends DemandRouteLegDedupe>(legs: T[]): T[] {
  const sortedInput = [...legs].sort(compareDemandRouteLegsStable);
  const map = new Map<string, T>();
  for (const leg of sortedInput) {
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
  return Array.from(map.values()).sort(compareDemandRouteLegsStable);
}
