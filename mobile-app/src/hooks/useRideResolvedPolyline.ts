import { useEffect, useMemo, useRef, useState } from 'react';
import { loadRidePolyline, type ResolvedPolyline } from '../lib/resolveRidePolyline';
import type { Point } from '../lib/geo';
import type { RideStopForReserve } from '../rides/api';

function routePolyFingerprint(raw: unknown): string {
  if (raw == null) return '∅';
  if (Array.isArray(raw)) return `a:${raw.length}`;
  if (typeof raw === 'string') return `s:${raw.length}`;
  return 'x';
}

function stopsFingerprint(stops: RideStopForReserve[]): string {
  const sorted = [...stops].sort((a, b) => a.stop_order - b.stop_order);
  return sorted.map((s) => `${s.id}:${s.stop_order}:${s.lat},${s.lng}`).join('|');
}

/**
 * Una sola resolución de polyline por viaje (mapa + navegación del conductor).
 * Evita dos `loadRidePolyline` en paralelo (RideDetailRouteMap + RideDetailScreen).
 */
export function useRideResolvedPolyline(
  ride: Record<string, unknown> | null,
  rideStops: RideStopForReserve[]
): ResolvedPolyline & { loading: boolean } {
  const rideId = ride ? String(ride.id ?? '') : '';
  const routePolyDepsKey = useMemo(
    () => routePolyFingerprint(ride?.base_route_polyline),
    [ride?.base_route_polyline]
  );
  const stopsKey = useMemo(() => stopsFingerprint(rideStops), [rideStops]);

  const [state, setState] = useState<{ loading: boolean; data: ResolvedPolyline | null }>({
    loading: false,
    data: null,
  });

  const rideRef = useRef(ride);
  const stopsRef = useRef(rideStops);
  rideRef.current = ride;
  stopsRef.current = rideStops;

  useEffect(() => {
    const r = rideRef.current;
    if (!r) {
      setState({ loading: false, data: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, data: null });
    void loadRidePolyline(r, stopsRef.current)
      .then((res) => {
        if (!cancelled) setState({ loading: false, data: res });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, data: { points: [], source: 'empty' } });
      });
    return () => {
      cancelled = true;
    };
  }, [rideId, routePolyDepsKey, stopsKey]);

  if (!ride) {
    return { points: [] as Point[], source: 'empty', loading: false };
  }

  return {
    points: state.data?.points ?? [],
    source: state.data?.source ?? 'empty',
    loading: state.loading,
  };
}
