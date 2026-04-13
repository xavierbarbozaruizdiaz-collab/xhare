'use client';

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

export type AdminCorridorMapItem = {
  id: string;
  name: string;
  slug: string;
  origin_zone: Record<string, unknown>;
  destination_zone: Record<string, unknown>;
  sort_priority: number;
  is_active: boolean;
};

export type CorridorLayerVisibility = Record<string, { origin: boolean; dest: boolean }>;

export type CorridorZoneBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type RectMeta = { corridorId: string; kind: 'origin' | 'destination' };

type PmRectangle = L.Rectangle & { pm?: { enable: (opts?: Record<string, unknown>) => void } };

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
  return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
}

function boundsToBox(b: L.LatLngBounds): CorridorZoneBox {
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return {
    minLat: sw.lat,
    maxLat: ne.lat,
    minLng: sw.lng,
    maxLng: ne.lng,
  };
}

type Props = {
  corridors: AdminCorridorMapItem[];
  visibility: CorridorLayerVisibility;
  onZoneEdited: (corridorId: string, kind: 'origin' | 'destination', box: CorridorZoneBox) => void;
  height?: string;
  className?: string;
};

type MapWithPm = L.Map & {
  pm?: {
    addControls: (o?: Record<string, unknown>) => void;
    removeControls: () => void;
    enableGlobalEditMode: (o?: Record<string, unknown>) => void;
    disableGlobalEditMode: () => void;
  };
};

/**
 * Mapa OSM + Geoman: rectángulos editables; capas según `visibility`.
 */
export default function AdminCorridorsMap({
  corridors,
  visibility,
  onZoneEdited,
  height = 'min(52vh, 480px)',
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitialFitRef = useRef(false);
  const onZoneEditedRef = useRef(onZoneEdited);
  onZoneEditedRef.current = onZoneEdited;

  const scheduleCommit = useCallback((meta: RectMeta, layer: L.Rectangle) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const b = layer.getBounds();
      onZoneEditedRef.current(meta.corridorId, meta.kind, boundsToBox(b));
    }, 650);
  }, []);

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
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      (map as MapWithPm).pm?.disableGlobalEditMode();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      didInitialFitRef.current = false;
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
      const vis = visibility[c.id];
      const showOrigin = vis?.origin !== false;
      const showDest = vis?.dest !== false;
      const active = c.is_active;
      const oB = zoneToBounds(c.origin_zone);
      const dB = zoneToBounds(c.destination_zone);
      const baseOpts = active
        ? { fillOpacity: 0.22, weight: 2 }
        : { fillOpacity: 0.08, weight: 1, dashArray: '6 6' as const };

      const attach = (rect: L.Rectangle, meta: RectMeta, title: string) => {
        (rect as PmRectangle).pm?.enable({ preventMarkerRemoval: true });
        rect.bindPopup(
          `<strong>${escapePopup(c.name)}</strong><br/><span style="font-size:12px;color:#444">${escapePopup(title)}<br/>Arrastrá los vértices del borde para cambiar la caja.</span>`
        );
        rect.on('pm:update', () => {
          scheduleCommit(meta, rect);
        });
      };

      if (oB && showOrigin) {
        const rect = L.rectangle(oB, {
          color: '#0369a1',
          fillColor: '#0284c7',
          ...baseOpts,
        }).addTo(group);
        attach(rect, { corridorId: c.id, kind: 'origin' }, `Origen · prioridad ${c.sort_priority}${active ? '' : ' · inactivo'} · ${c.slug}`);
        allCorners.push(oB.getSouthWest(), oB.getNorthEast());
      }
      if (dB && showDest) {
        const rect = L.rectangle(dB, {
          color: '#c2410c',
          fillColor: '#ea580c',
          ...baseOpts,
        }).addTo(group);
        attach(rect, { corridorId: c.id, kind: 'destination' }, `Destino · prioridad ${c.sort_priority}${active ? '' : ' · inactivo'} · ${c.slug}`);
        allCorners.push(dB.getSouthWest(), dB.getNorthEast());
      }
    }

    if (allCorners.length > 0 && !didInitialFitRef.current) {
      map.fitBounds(L.latLngBounds(allCorners), { padding: [40, 40], maxZoom: 11 });
      didInitialFitRef.current = true;
    }
    if (corridors.length === 0) {
      didInitialFitRef.current = false;
    }

    const mpm = (map as MapWithPm).pm;
    mpm?.disableGlobalEditMode();
    mpm?.enableGlobalEditMode({ snappable: true });
  }, [corridors, visibility, scheduleCommit]);

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

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Los rectángulos están en <strong>modo edición</strong>: arrastrá los vértices para agrandar o achicar. Los
        cambios se guardan en la base al terminar el ajuste (breve retraso). Para mover el mapa, arrastrá fuera de los
        vértices o usá zoom +/−.
      </p>
      <div
        ref={containerRef}
        className={`w-full z-0 rounded-xl overflow-hidden border border-gray-200 ${className}`}
        style={{ height, minHeight: 280 }}
      />
    </div>
  );
}
