'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type DispatchMapMarker = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  title: string;
  subtitle: string;
};

function escapePopup(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Props = {
  markers: DispatchMapMarker[];
  routePoints: Array<{ lat: number; lng: number }>;
  onMarkerDoubleClick?: (m: DispatchMapMarker) => void;
  height?: string;
  className?: string;
};

export default function AdminDispatchMap({ markers, routePoints, onMarkerDoubleClick, height = '480px', className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const handlerRef = useRef<typeof onMarkerDoubleClick>(onMarkerDoubleClick);
  handlerRef.current = onMarkerDoubleClick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([-25.2637, -57.5759], 11);
    /** Evita que doble clic en el mapa haga zoom (choca con “añadir parada”). Zoom: +/− o rueda. */
    map.doubleClickZoom.disable();
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    markersLayerRef.current = L.layerGroup().addTo(map);
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      if (routeLineRef.current) {
        routeLineRef.current.remove();
        routeLineRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    const bounds: L.LatLng[] = [];
    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      const icon = L.divIcon({
        className: 'admin-dispatch-marker',
        html: `<div style="background:${m.color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const mk = L.marker([m.lat, m.lng], { icon }).addTo(group);
      const h = handlerRef.current;
      const wrap = L.DomUtil.create('div');
      wrap.style.minWidth = '200px';
      wrap.innerHTML = `<strong>${escapePopup(m.title)}</strong><br/><span style="font-size:12px;color:#444;line-height:1.35">${escapePopup(m.subtitle)}</span>`;
      if (h) {
        const btn = L.DomUtil.create('button', '', wrap) as HTMLButtonElement;
        btn.type = 'button';
        btn.textContent = 'Añadir a la ruta';
        btn.style.marginTop = '10px';
        btn.style.padding = '8px 14px';
        btn.style.borderRadius = '8px';
        btn.style.background = '#166534';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = '600';
        btn.style.fontSize = '13px';
        L.DomEvent.on(btn, 'click', (domEv) => {
          L.DomEvent.stop(domEv);
          h(m);
          mk.closePopup();
        });
      }
      mk.bindPopup(wrap);
      bounds.push(L.latLng(m.lat, m.lng));
    }

    if (routePoints.length >= 2) {
      const ll = routePoints.map((p) => [p.lat, p.lng] as L.LatLngExpression);
      routeLineRef.current = L.polyline(ll, { color: '#0f766e', weight: 5, opacity: 0.85 }).addTo(map);
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [48, 48], maxZoom: 13 });
    }
  }, [markers, routePoints]);

  return <div ref={containerRef} className={`w-full z-0 ${className}`} style={{ height, minHeight: 280 }} />;
}
