'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Stop {
  lat: number;
  lng: number;
  label?: string | null;
  stop_order: number;
}

export type PassengerPoint = { lat: number; lng: number; label?: string | null };

function samePoint(a: { lat: number; lng: number }, b: { lat?: number | null; lng?: number | null }): boolean {
  if (b?.lat == null || b?.lng == null) return false;
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

interface RideRouteMapProps {
  stops: Stop[];
  /** Opcional: polyline de la ruta base [{lat, lng}, ...] */
  polyline?: Array<{ lat: number; lng: number }> | null;
  /** Puntos de recogida de pasajeros (subidas) para mostrar ruta actualizada */
  passengerPickups?: PassengerPoint[];
  /** Puntos de descenso de pasajeros (bajadas) para mostrar ruta actualizada */
  passengerDropoffs?: PassengerPoint[];
  /** Recogida del usuario actual (se muestra en verde; el resto de subidas en gris) */
  myPickup?: { lat: number; lng: number; label?: string | null } | null;
  /** Bajada del usuario actual (se muestra en naranja; el resto de bajadas en otro color) */
  myDropoff?: { lat: number; lng: number; label?: string | null } | null;
  /** Posición en vivo del conductor (cuando el viaje está en curso) */
  driverLocation?: { lat: number; lng: number } | null;
  className?: string;
  height?: string;
}

export default function RideRouteMap({
  stops,
  polyline,
  passengerPickups = [],
  passengerDropoffs = [],
  myPickup = null,
  myDropoff = null,
  driverLocation = null,
  className = '',
  height = '280px',
}: RideRouteMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);

  const sortedStops = [...stops].sort((a, b) => a.stop_order - b.stop_order);

  useEffect(() => {
    if (!containerRef.current || sortedStops.length === 0) return;
    const center: [number, number] = sortedStops.length > 0
      ? [sortedStops[0].lat, sortedStops[0].lng]
      : [-25.2637, -57.5759];
    const map = L.map(containerRef.current, { zoomControl: false }).setView(center, 12);
    mapRef.current = map;
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
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
    if (!mapRef.current || sortedStops.length === 0) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    const n = sortedStops.length;
    sortedStops.forEach((stop, i) => {
      const isFirst = i === 0;
      const isLast = i === n - 1;
      const color = isFirst ? '#dc2626' : isLast ? '#16a34a' : '#2563eb';
      const num = isFirst ? '1' : isLast ? String(n) : String(i + 1);
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background-color:${color};width:24px;height:24px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:11px;">${num}</div>`,
      });
      const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(mapRef.current!);
      if (stop.label) marker.bindTooltip(stop.label, { permanent: false });
      markersRef.current.push(marker);
    });
    passengerPickups.forEach((p) => {
      const isMine = myPickup != null && samePoint(p, myPickup);
      const color = isMine ? '#22c55e' : '#6b7280';
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(mapRef.current!);
      const tooltip = isMine ? `Tu recogida: ${String(p.label || '').slice(0, 50)}` : `Recogida otro pasajero: ${String(p.label || '').slice(0, 50)}`;
      if (p.label || isMine) marker.bindTooltip(tooltip, { permanent: false });
      markersRef.current.push(marker);
    });
    passengerDropoffs.forEach((p) => {
      const isMine = myDropoff != null && samePoint(p, myDropoff);
      const color = isMine ? '#f59e0b' : '#64748b';
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(mapRef.current!);
      const tooltip = isMine ? `Tu bajada: ${String(p.label || '').slice(0, 50)}` : `Bajada otro pasajero: ${String(p.label || '').slice(0, 50)}`;
      if (p.label || isMine) marker.bindTooltip(tooltip, { permanent: false });
      markersRef.current.push(marker);
    });
    if (driverLocation?.lat != null && driverLocation?.lng != null) {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:#2563eb;width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
      });
      const marker = L.marker([driverLocation.lat, driverLocation.lng], { icon }).addTo(mapRef.current!);
      marker.bindTooltip('Conductor en camino', { permanent: false });
      markersRef.current.push(marker);
    }
  }, [sortedStops, passengerPickups, passengerDropoffs, myPickup, myDropoff, driverLocation]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
    const points: L.LatLngExpression[] = polyline && polyline.length >= 2
      ? polyline.map(p => [p.lat, p.lng] as L.LatLngExpression)
      : sortedStops.map(s => [s.lat, s.lng] as L.LatLngExpression);
    if (points.length >= 2) {
      polylineRef.current = L.polyline(points, { color: '#16a34a', weight: 4 }).addTo(mapRef.current);
      mapRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [24, 24], maxZoom: 14 });
    } else if (sortedStops.length > 0) {
      mapRef.current.setView([sortedStops[0].lat, sortedStops[0].lng], 12);
    }
  }, [sortedStops, polyline]);

  if (sortedStops.length === 0) return null;

  return (
    <div className={className} style={{ height }}>
      <div ref={containerRef} className="w-full h-full rounded-lg" />
    </div>
  );
}
