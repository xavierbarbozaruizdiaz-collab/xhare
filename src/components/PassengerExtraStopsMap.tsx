'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { validateRouteDeviation } from '@/lib/routing/route-validator';

export type ExtraStopPoint = { lat: number; lng: number; label?: string | null; order: number };

interface PassengerExtraStopsMapProps {
  baseRoute: Array<{ lat: number; lng: number }>;
  pickup: { lat: number; lng: number; label?: string } | null;
  dropoff: { lat: number; lng: number; label?: string } | null;
  stops: ExtraStopPoint[];
  maxDeviationKm: number;
  onStopsChange: (stops: ExtraStopPoint[]) => void;
  height?: string;
  className?: string;
}

export default function PassengerExtraStopsMap({
  baseRoute,
  pickup,
  dropoff,
  stops,
  maxDeviationKm,
  onStopsChange,
  height = '220px',
  className = '',
}: PassengerExtraStopsMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const clickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingLabel, setLoadingLabel] = useState(false);

  const hasRoute = baseRoute && baseRoute.length >= 2;

  useEffect(() => {
    if (!containerRef.current || !hasRoute) return;
    const center = baseRoute[Math.floor(baseRoute.length / 2)];
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
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [hasRoute, baseRoute]);

  useEffect(() => {
    if (!mapRef.current || !hasRoute) return;
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
    const latlngs = baseRoute.map((p) => [p.lat, p.lng] as L.LatLngExpression);
    polylineRef.current = L.polyline(latlngs, { color: '#16a34a', weight: 4 }).addTo(mapRef.current);
    mapRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [24, 24], maxZoom: 14 });
  }, [baseRoute, hasRoute]);

  useEffect(() => {
    if (!mapRef.current || !hasRoute) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const map = mapRef.current;

    if (pickup) {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: '<div style="background:#22c55e;width:22px;height:22px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:10px;">A</div>',
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

    const sortedStops = [...stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    sortedStops.forEach((s) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:#7c3aed;width:18px;height:18px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:10px;">${s.order}</div>`,
      });
      const m = L.marker([s.lat, s.lng], { icon }).addTo(map);
      if (s.label) m.bindTooltip(`Parada extra ${s.order}: ${String(s.label).slice(0, 50)}`, { permanent: false });
      markersRef.current.push(m);
    });
  }, [pickup, dropoff, stops, hasRoute, baseRoute]);

  useEffect(() => {
    if (!mapRef.current || !hasRoute) return;
    if (clickHandlerRef.current) {
      mapRef.current.off('click', clickHandlerRef.current);
    }
    const handler = async (e: L.LeafletMouseEvent) => {
      if (stops.length >= 3) {
        setError('Podés agregar hasta 3 paradas extra.');
        return;
      }
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      const { isValid, distanceMeters } = validateRouteDeviation(point, baseRoute, maxDeviationKm);
      setError(null);
      if (!isValid) {
        setError(`La parada debe estar a máximo ${maxDeviationKm} km de la ruta. Distancia: ${(distanceMeters / 1000).toFixed(2)} km.`);
        return;
      }
      setLoadingLabel(true);
      try {
        const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
        const label = res.ok ? (await res.json()).display_name : `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
        const order = stops.length + 1;
        const next = [...stops, { ...point, label, order }];
        onStopsChange(next);
      } catch {
        const order = stops.length + 1;
        const next = [...stops, { ...point, label: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`, order }];
        onStopsChange(next);
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
  }, [baseRoute, hasRoute, maxDeviationKm, stops, onStopsChange]);

  function handleRemove(order: number) {
    const next = stops.filter((s) => s.order !== order).map((s, idx) => ({ ...s, order: idx + 1 }));
    onStopsChange(next);
  }

  function handleClear() {
    onStopsChange([]);
    setError(null);
  }

  if (!hasRoute) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap gap-2 items-center text-xs text-gray-600">
        <span><span className="inline-block w-3 h-3 rounded-full bg-green-500 align-middle mr-1" /> Tu recogida (A)</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-blue-500 align-middle mr-1" /> Tu bajada (B)</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-purple-600 align-middle mr-1" /> Paradas extra (1–3)</span>
      </div>
      <div ref={containerRef} style={{ height }} className="rounded-lg border border-gray-200" />
      {error && (
        <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 items-center text-xs text-gray-600">
        <button
          type="button"
          onClick={handleClear}
          className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50"
        >
          Quitar paradas extra
        </button>
        {loadingLabel && <span className="text-gray-400">Obteniendo dirección…</span>}
      </div>
      {stops.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {stops.sort((a, b) => a.order - b.order).map((s) => (
            <li key={s.order} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-semibold text-purple-700 mr-1">Parada {s.order}:</span>
                {s.label ? s.label.slice(0, 80) : `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(s.order)}
                className="text-xs text-red-500 hover:underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

