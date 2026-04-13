'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type AdminCorridorMapItem = {
  id: string;
  name: string;
  slug: string;
  origin_zone: Record<string, unknown>;
  destination_zone: Record<string, unknown>;
  sort_priority: number;
  is_active: boolean;
};

function escapePopup(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function zoneToBounds(zone: Record<string, unknown>): L.LatLngBounds | null {
  const n = (k: string) => {
    const v = zone[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const p = parseFloat(v);
      return Number.isFinite(p) ? p : NaN;
    }
    return NaN;
  };
  const minLat = n('minLat');
  const maxLat = n('maxLat');
  const minLng = n('minLng');
  const maxLng = n('maxLng');
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  return L.latLngBounds(
    [minLat, minLng],
    [maxLat, maxLng]
  );
}

type Props = {
  corridors: AdminCorridorMapItem[];
  height?: string;
  className?: string;
};

/**
 * Mapa OSM: rectángulos zona origen (azul) y zona destino (naranja) por corredor.
 */
export default function AdminCorridorsMap({ corridors, height = 'min(52vh, 480px)', className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([-25.35, -57.45], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayRef.current;
    if (!map || !group) return;
    group.clearLayers();

    const allCorners: L.LatLng[] = [];
    const sorted = [...corridors].sort((a, b) => a.sort_priority - b.sort_priority);

    for (const c of sorted) {
      const active = c.is_active;
      const oB = zoneToBounds(c.origin_zone);
      const dB = zoneToBounds(c.destination_zone);
      const baseOpts = active
        ? { fillOpacity: 0.22, weight: 2 }
        : { fillOpacity: 0.08, weight: 1, dashArray: '6 6' as const };

      if (oB) {
        const rect = L.rectangle(oB, {
          color: '#0369a1',
          fillColor: '#0284c7',
          ...baseOpts,
        }).addTo(group);
        rect.bindPopup(
          `<strong>${escapePopup(c.name)}</strong><br/><span style="font-size:12px;color:#444">Origen · prioridad ${c.sort_priority}${active ? '' : ' · inactivo'}<br/><code>${escapePopup(c.slug)}</code></span>`
        );
        allCorners.push(oB.getSouthWest(), oB.getNorthEast());
      }
      if (dB) {
        const rect = L.rectangle(dB, {
          color: '#c2410c',
          fillColor: '#ea580c',
          ...baseOpts,
        }).addTo(group);
        rect.bindPopup(
          `<strong>${escapePopup(c.name)}</strong><br/><span style="font-size:12px;color:#444">Destino · prioridad ${c.sort_priority}${active ? '' : ' · inactivo'}<br/><code>${escapePopup(c.slug)}</code></span>`
        );
        allCorners.push(dB.getSouthWest(), dB.getNorthEast());
      }
    }

    if (allCorners.length > 0) {
      map.fitBounds(L.latLngBounds(allCorners), { padding: [40, 40], maxZoom: 11 });
    }
  }, [corridors]);

  if (corridors.length === 0) {
    return (
      <div
        className={`rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-500 text-sm ${className}`}
        style={{ height, minHeight: 200 }}
      >
        Sin corredores para dibujar.
      </div>
    );
  }

  return <div ref={containerRef} className={`w-full z-0 rounded-xl overflow-hidden border border-gray-200 ${className}`} style={{ height, minHeight: 280 }} />;
}
