'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { validateRouteDeviation } from '@/lib/routing/route-validator';

export type MapPoint = { lat: number; lng: number; label?: string } | null;

/** Paradas fijas del conductor (origen, waypoints, destino) para mostrarlas numeradas en el trazado. */
export type DriverStop = { lat: number; lng: number; label?: string | null; stop_order?: number };

/** Parada extra del pasajero (máx. 3 por reserva). */
export type ExtraStopPoint = { lat: number; lng: number; label?: string | null; order: number };

interface PickupDropoffMapProps {
  baseRoute: Array<{ lat: number; lng: number }>;
  maxDeviationKm: number;
  existingPickups: Array<{ lat: number; lng: number; label?: string | null }>;
  existingDropoffs: Array<{ lat: number; lng: number; label?: string | null }>;
  /** Paradas fijadas por el conductor (opcional): se muestran numeradas en el mapa. */
  driverStops?: DriverStop[];
  pickup: MapPoint;
  dropoff: MapPoint;
  onPickupChange: (point: MapPoint) => void;
  onDropoffChange: (point: MapPoint) => void;
  /** Paradas extra opcionales (máx. 3). Si se pasan, se muestran en el mismo mapa y se puede agregar/quitar. */
  extraStops?: ExtraStopPoint[];
  onExtraStopsChange?: (stops: ExtraStopPoint[]) => void;
  height?: string;
  className?: string;
}

export default function PickupDropoffMap({
  baseRoute,
  maxDeviationKm,
  existingPickups,
  existingDropoffs,
  driverStops = [],
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  extraStops = [],
  onExtraStopsChange,
  height = '320px',
  className = '',
}: PickupDropoffMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const clickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const [step, setStep] = useState<'pickup' | 'dropoff' | 'extra'>('pickup');
  const [error, setError] = useState<string | null>(null);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);

  const hasExtraStopsFeature = typeof onExtraStopsChange === 'function';
  const canAddExtraStop = hasExtraStopsFeature && pickup && dropoff && extraStops.length < 3;

  const hasRoute = baseRoute && baseRoute.length >= 2;

  useEffect(() => {
    if (!containerRef.current) return;
    const center = hasRoute ? baseRoute[Math.floor(baseRoute.length / 2)] : { lat: -25.2637, lng: -57.5759 };
    const map = L.map(containerRef.current, { zoomControl: false }).setView([center.lat, center.lng], 12);
    mapRef.current = map;
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      if (clickHandlerRef.current && mapRef.current) {
        mapRef.current.off('click', clickHandlerRef.current);
      }
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
    if (hasRoute) {
      const latlngs = baseRoute.map(p => [p.lat, p.lng] as L.LatLngExpression);
      polylineRef.current = L.polyline(latlngs, { color: '#16a34a', weight: 4 }).addTo(mapRef.current);
      mapRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [30, 30], maxZoom: 14 });
    }
  }, [baseRoute, hasRoute]);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    const map = mapRef.current;

    // Paradas del conductor: sin numeración y color neutro (no azul) para no confundir con "Tu bajada (B)"
    const sortedDriverStops = [...driverStops].filter(s => s.lat != null && s.lng != null).sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    const driverStopColor = '#6b7280';
    sortedDriverStops.forEach((stop) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:${driverStopColor};width:18px;height:18px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
      });
      const m = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
      if (stop.label) m.bindTooltip(`Parada: ${String(stop.label).slice(0, 40)}`, { permanent: false });
      markersRef.current.push(m);
    });

    // Subidas y bajadas de otros pasajeros: color distinto (gris/slate) para no confundir con Tu recogida (A) y Tu bajada (B)
    const otherPickupColor = '#94a3b8';
    const otherDropoffColor = '#64748b';
    existingPickups.forEach((p) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:${otherPickupColor};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(map);
      if (p.label) m.bindTooltip(`Subida otro pasajero: ${String(p.label).slice(0, 50)}`, { permanent: false });
      markersRef.current.push(m);
    });
    existingDropoffs.forEach((p) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:${otherDropoffColor};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(map);
      if (p.label) m.bindTooltip(`Bajada otro pasajero: ${String(p.label).slice(0, 50)}`, { permanent: false });
      markersRef.current.push(m);
    });

    if (pickup) {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: '<div style="background:#dc2626;width:22px;height:22px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:10px;">A</div>',
      });
      const m = L.marker([pickup.lat, pickup.lng], { icon }).addTo(map);
      if (pickup.label) m.bindTooltip(`Tu recogida: ${pickup.label.slice(0, 40)}`, { permanent: false });
      markersRef.current.push(m);
    }
    if (dropoff) {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: '<div style="background:#2563eb;width:22px;height:22px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:10px;">B</div>',
      });
      const m = L.marker([dropoff.lat, dropoff.lng], { icon }).addTo(map);
      if (dropoff.label) m.bindTooltip(`Tu bajada: ${dropoff.label.slice(0, 40)}`, { permanent: false });
      markersRef.current.push(m);
    }
    // Paradas extra (máx. 3) en el mismo mapa
    const sortedExtra = [...extraStops].filter(s => s.lat != null && s.lng != null).sort((a, b) => a.order - b.order);
    sortedExtra.forEach((s) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:#7c3aed;width:18px;height:18px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:10px;">${s.order}</div>`,
      });
      const m = L.marker([s.lat, s.lng], { icon }).addTo(map);
      if (s.label) m.bindTooltip(`Parada extra ${s.order}: ${String(s.label).slice(0, 50)}`, { permanent: false });
      markersRef.current.push(m);
    });
  }, [existingPickups, existingDropoffs, driverStops, pickup, dropoff, extraStops]);

  useEffect(() => {
    if (!mapRef.current || !hasRoute) return;
    if (clickHandlerRef.current) {
      mapRef.current.off('click', clickHandlerRef.current);
    }
    const handler = async (e: L.LeafletMouseEvent) => {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      const { isValid, distanceMeters } = validateRouteDeviation(point, baseRoute, maxDeviationKm);
      setError(null);
      if (!isValid) {
        setError(`El punto debe estar a máximo ${maxDeviationKm} km de la ruta. Distancia: ${(distanceMeters / 1000).toFixed(2)} km.`);
        return;
      }
      setLoadingLabel(true);
      try {
        const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
        const label = res.ok ? (await res.json()).display_name : `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
        const withLabel = { ...point, label };
        if (step === 'extra' && onExtraStopsChange && extraStops.length < 3) {
          const next = [...extraStops, { ...withLabel, label: label ?? null, order: extraStops.length + 1 }];
          onExtraStopsChange(next);
          setStep(next.length >= 3 ? 'dropoff' : 'extra');
        } else if (step === 'pickup') {
          onPickupChange(withLabel);
          setStep('dropoff');
        } else {
          onDropoffChange(withLabel);
        }
      } catch {
        const withLabel = { ...point, label: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` };
        if (step === 'extra' && onExtraStopsChange && extraStops.length < 3) {
          const next = [...extraStops, { ...withLabel, label: withLabel.label ?? null, order: extraStops.length + 1 }];
          onExtraStopsChange(next);
          setStep(next.length >= 3 ? 'dropoff' : 'extra');
        } else if (step === 'pickup') {
          onPickupChange(withLabel);
          setStep('dropoff');
        } else {
          onDropoffChange(withLabel);
        }
      }
      setLoadingLabel(false);
    };
    mapRef.current.on('click', handler);
    clickHandlerRef.current = handler;
    return () => {
      if (mapRef.current && clickHandlerRef.current) {
        mapRef.current.off('click', clickHandlerRef.current);
      }
    };
  }, [baseRoute, hasRoute, maxDeviationKm, step, extraStops, onPickupChange, onDropoffChange, onExtraStopsChange]);

  useEffect(() => {
    if (pickup && !dropoff) setStep('dropoff');
    if (!pickup) setStep('pickup');
    if (step === 'extra' && !canAddExtraStop) setStep('dropoff');
  }, [pickup, dropoff, canAddExtraStop, step]);

  function handleChangePickup() {
    onPickupChange(null);
    setStep('pickup');
    setError(null);
  }
  function handleChangeDropoff() {
    onDropoffChange(null);
    setStep('dropoff');
    setError(null);
  }

  async function handleUseMyLocation() {
    if (!hasRoute) {
      setError('No hay ruta para validar la ubicación.');
      return;
    }
    setError(null);
    setLoadingLocation(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const { isValid, distanceMeters } = validateRouteDeviation(point, baseRoute, maxDeviationKm);
      if (!isValid) {
        setError(`Tu ubicación está a ${(distanceMeters / 1000).toFixed(2)} km de la ruta. El punto debe estar a máximo ${maxDeviationKm} km.`);
        setLoadingLocation(false);
        return;
      }
      setLoadingLabel(true);
      const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
      const label = res.ok ? (await res.json()).display_name : `Ubicación actual (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`;
      const withLabel = { ...point, label };
      if (step === 'extra' && onExtraStopsChange && extraStops.length < 3) {
        const next = [...extraStops, { ...withLabel, label: withLabel.label ?? null, order: extraStops.length + 1 }];
        onExtraStopsChange(next);
        setStep(next.length >= 3 ? 'dropoff' : 'extra');
      } else if (step === 'pickup') {
        onPickupChange(withLabel);
        setStep('dropoff');
      } else {
        onDropoffChange(withLabel);
      }
      setLoadingLabel(false);
    } catch (err) {
      setError('No se pudo obtener tu ubicación. Revisá que el navegador tenga permiso o elegí en el mapa.');
    }
    setLoadingLocation(false);
  }

  function handleRemoveExtraStop(order: number) {
    if (!onExtraStopsChange) return;
    const next = extraStops.filter(s => s.order !== order).map((s, i) => ({ ...s, order: i + 1 }));
    onExtraStopsChange(next);
    setError(null);
  }

  function handleClearExtraStops() {
    if (!onExtraStopsChange) return;
    onExtraStopsChange([]);
    setStep('dropoff');
    setError(null);
  }

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 items-center text-sm text-gray-600">
        {driverStops.length > 0 && (
          <span><span className="inline-block w-3 h-3 rounded-full bg-gray-500 align-middle mr-1" /> Paradas del conductor</span>
        )}
        <span><span className="inline-block w-3 h-3 rounded-full bg-slate-400 align-middle mr-1" /> Subidas de otros</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-slate-600 align-middle mr-1" /> Bajadas de otros</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-red-500 align-middle mr-1" /> Tu recogida (A)</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-blue-500 align-middle mr-1" /> Tu bajada (B)</span>
        {hasExtraStopsFeature && (
          <span><span className="inline-block w-3 h-3 rounded-full bg-purple-600 align-middle mr-1" /> Paradas extra (opcional, máx. 3)</span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="rounded-lg border border-gray-200" />
      <div className="mt-2 flex flex-wrap gap-2 items-center">
        <p className="text-sm text-gray-600 w-full">
          {step === 'pickup' && !pickup && 'Elegí tu punto de recogida en el mapa o usá tu ubicación actual (máx. ' + maxDeviationKm + ' km de la ruta).'}
          {step === 'dropoff' && pickup && !dropoff && 'Elegí tu punto de descenso en el mapa o usá tu ubicación (máx. ' + maxDeviationKm + ' km de la ruta).'}
          {step === 'extra' && canAddExtraStop && 'Clic en el mapa para agregar una parada extra (máx. ' + maxDeviationKm + ' km de la ruta).'}
          {pickup && dropoff && step !== 'extra' && (hasExtraStopsFeature ? 'Recogida y descenso elegidos. Podés agregar hasta 3 paradas extra si querés.' : 'Recogida y descenso elegidos.')}
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => (pickup ? handleChangePickup() : (setStep('pickup'), setError(null)))}
            className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border-2 shadow-sm hover:shadow transition-all duration-200 ${pickup ? 'border-red-300 text-red-700 bg-white hover:bg-red-50 hover:border-red-400' : step === 'pickup' ? 'border-red-500 text-white bg-red-500 hover:bg-red-600' : 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100'}`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            {pickup ? 'Cambiar recogida' : 'Elegir recogida'}
          </button>
          <button
            type="button"
            onClick={() => (dropoff ? handleChangeDropoff() : (setStep('dropoff'), setError(null)))}
            className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border-2 shadow-sm hover:shadow transition-all duration-200 ${dropoff ? 'border-blue-300 text-blue-700 bg-white hover:bg-blue-50 hover:border-blue-400' : step === 'dropoff' ? 'border-blue-500 text-white bg-blue-500 hover:bg-blue-600' : 'border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100'}`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            {dropoff ? 'Cambiar descenso' : 'Elegir descenso'}
          </button>
          {canAddExtraStop && (
            <button
              type="button"
              onClick={() => (setStep('extra'), setError(null))}
              className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border-2 shadow-sm hover:shadow transition-all duration-200 ${step === 'extra' ? 'border-purple-500 text-white bg-purple-500 hover:bg-purple-600' : 'border-purple-300 text-purple-700 bg-white hover:bg-purple-50'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              Agregar parada extra
            </button>
          )}
          {hasExtraStopsFeature && extraStops.length > 0 && (
            <button
              type="button"
              onClick={handleClearExtraStops}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border-2 border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
            >
              Quitar paradas extra
            </button>
          )}
          {hasRoute && (
            <button
              type="button"
              onClick={handleUseMyLocation}
              disabled={loadingLocation}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border-2 border-gray-300 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 shadow-sm hover:shadow transition-all duration-200 disabled:opacity-60"
            >
              {loadingLocation ? (
                <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-base" title="Ubicación">📍</span>
              )}
              Usar mi ubicación
            </button>
          )}
        </div>
      </div>
      {extraStops.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {[...extraStops].sort((a, b) => a.order - b.order).map((s) => (
            <li key={s.order} className="flex items-center justify-between gap-2">
              <span><span className="font-semibold text-purple-700 mr-1">Parada {s.order}:</span>{s.label ? s.label.slice(0, 60) : `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}</span>
              <button type="button" onClick={() => handleRemoveExtraStop(s.order)} className="text-red-500 hover:underline text-xs">Quitar</button>
            </li>
          ))}
        </ul>
      )}
      {loadingLabel && <p className="text-sm text-gray-500 mt-1">Obteniendo dirección...</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
