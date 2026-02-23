'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface RouteThumbnailProps {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  className?: string;
  width?: string;
  height?: string;
}

export default function RouteThumbnail({
  origin,
  destination,
  className = '',
  width = '220px',
  height = '120px',
}: RouteThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const bounds = L.latLngBounds([ [origin.lat, origin.lng], [destination.lat, destination.lng] ]);
    const center = bounds.getCenter();
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([center.lat, center.lng], 11);
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    const line = L.polyline(
      [ [origin.lat, origin.lng], [destination.lat, destination.lng] ],
      { color: '#16a34a', weight: 3 }
    ).addTo(map);
    polylineRef.current = line;

    const iconA = L.divIcon({
      className: 'border-0 bg-transparent',
      html: '<div style="background:#dc2626;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>',
    });
    const iconB = L.divIcon({
      className: 'border-0 bg-transparent',
      html: '<div style="background:#16a34a;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>',
    });
    const m1 = L.marker([origin.lat, origin.lng], { icon: iconA }).addTo(map);
    const m2 = L.marker([destination.lat, destination.lng], { icon: iconB }).addTo(map);
    markersRef.current = [m1, m2];

    map.fitBounds(bounds.pad(0.15));
    setTimeout(() => map.invalidateSize(), 50);

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
  }, [origin.lat, origin.lng, destination.lat, destination.lng]);

  return (
    <div
      className={`rounded-lg overflow-hidden border border-gray-200 bg-gray-100 ${className}`}
      style={{ width, height, minWidth: width, minHeight: height }}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
