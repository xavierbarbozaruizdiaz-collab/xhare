'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Point = { lat: number; lng: number };

type Props = {
  polyline: Point[];
  driverLat: number | null;
  driverLng: number | null;
  className?: string;
  height?: string;
};

export default function SafetyShareLiveMap({
  polyline,
  driverLat,
  driverLng,
  className = '',
  height = 'min(52vh, 360px)',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const hasDriver =
      driverLat != null && driverLng != null && Number.isFinite(driverLat) && Number.isFinite(driverLng);
    const route = polyline.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const center: [number, number] = hasDriver
      ? [driverLat!, driverLng!]
      : route.length > 0
        ? [route[0].lat, route[0].lng]
        : [-25.2637, -57.5759];

    const map = L.map(containerRef.current, { zoomControl: true }).setView(center, hasDriver ? 14 : 12);
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    const fitAll = () => {
      const bounds = L.latLngBounds([]);
      if (route.length >= 2) {
        route.forEach((p) => bounds.extend([p.lat, p.lng]));
      }
      if (hasDriver) bounds.extend([driverLat!, driverLng!]);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
      }
    };

    if (route.length >= 2) {
      routeRef.current = L.polyline(
        route.map((p) => [p.lat, p.lng] as L.LatLngExpression),
        { color: '#16a34a', weight: 4, opacity: 0.85 }
      ).addTo(map);
    }

    fitAll();
    const t = setTimeout(() => {
      map.invalidateSize();
      fitAll();
    }, 120);

    return () => {
      clearTimeout(t);
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      routeRef.current?.remove();
      routeRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const hasDriver =
      driverLat != null && driverLng != null && Number.isFinite(driverLat) && Number.isFinite(driverLng);

    if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }

    if (hasDriver) {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: `<div style="background:#2563eb;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>`,
      });
      driverMarkerRef.current = L.marker([driverLat!, driverLng!], { icon })
        .addTo(mapRef.current)
        .bindTooltip('Conductor', { permanent: false });
    }

    const route = polyline.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (routeRef.current) {
      routeRef.current.remove();
      routeRef.current = null;
    }
    if (route.length >= 2) {
      routeRef.current = L.polyline(
        route.map((p) => [p.lat, p.lng] as L.LatLngExpression),
        { color: '#16a34a', weight: 4, opacity: 0.85 }
      ).addTo(mapRef.current);
    }

    const bounds = L.latLngBounds([]);
    if (route.length >= 2) route.forEach((p) => bounds.extend([p.lat, p.lng]));
    if (hasDriver) bounds.extend([driverLat!, driverLng!]);
    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    } else if (hasDriver) {
      mapRef.current.setView([driverLat!, driverLng!], 14);
    }
  }, [polyline, driverLat, driverLng]);

  return (
    <div className={className} style={{ height }}>
      <div ref={containerRef} className="h-full w-full rounded-xl border border-slate-200 shadow-inner" />
    </div>
  );
}
