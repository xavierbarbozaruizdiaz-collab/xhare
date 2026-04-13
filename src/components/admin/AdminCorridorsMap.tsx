'use client';

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { Point } from '@/types';
import { DEMAND_SYNC_CORRIDOR_METERS, tubePolygonFromPolyline } from '@/lib/polylineTube';

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

/** Polilínea base de un grupo `demand_route_groups` (sync geo) para el tubo visual. */
export type DemandTubeLayer = {
  id: string;
  polyline: Point[];
  label: string;
  requested_date: string;
  passenger_count: number;
};

type RectMeta = { corridorId: string; kind: 'origin' | 'destination' };

type PmRectangle = L.Rectangle & { pm?: { enable: (opts?: Record<string, unknown>) => void } };

type PathOptsPm = L.PathOptions & { pmIgnore?: boolean };

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
  /** Grupos de demanda con `base_polyline` (mismo criterio de tubo que sync ~2 km). */
  demandTubes?: DemandTubeLayer[];
  showDemandTubes?: boolean;
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
 * Mapa OSM + Geoman: tubos violeta (grupos sync) bajo los rectángulos de corredor editables.
 */
export default function AdminCorridorsMap({
  corridors,
  visibility,
  onZoneEdited,
  demandTubes = [],
  showDemandTubes = false,
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

    if (showDemandTubes && demandTubes.length > 0) {
      const tubeOpts: PathOptsPm = {
        color: '#5b21b6',
        weight: 1,
        fillColor: '#9333ea',
        fillOpacity: 0.14,
        pmIgnore: true,
      };
      for (const t of demandTubes) {
        const ring = tubePolygonFromPolyline(t.polyline, DEMAND_SYNC_CORRIDOR_METERS);
        if (!ring || ring.length < 3) continue;
        const latlngs = ring.map((p) => L.latLng(p.lat, p.lng));
        const poly = L.polygon(latlngs, tubeOpts).addTo(group);
        const tubePopup =
          `<strong>Tubo sync (~${DEMAND_SYNC_CORRIDOR_METERS / 1000} km)</strong><br/><span style="font-size:12px;color:#444">${escapePopup(t.label)}<br/>Fecha: ${escapePopup(t.requested_date)} · ${t.passenger_count} plaza(s)<br/>Grupo <code>${escapePopup(t.id.slice(0, 8))}…</code></span>`;
        poly.bindPopup(tubePopup);
        for (const p of ring) {
          allCorners.push(L.latLng(p.lat, p.lng));
        }
        const axis = L.polyline(
          t.polyline.map((p) => [p.lat, p.lng] as L.LatLngExpression),
          { color: '#6d28d9', weight: 2, opacity: 0.55, dashArray: '6 4', pmIgnore: true } as PathOptsPm
        ).addTo(group);
        axis.bindPopup(tubePopup);
      }
    }

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
    if (corridors.length === 0 && (!showDemandTubes || demandTubes.length === 0)) {
      didInitialFitRef.current = false;
    }

    const mpm = (map as MapWithPm).pm;
    mpm?.disableGlobalEditMode();
    if (corridors.length > 0) {
      mpm?.enableGlobalEditMode({ snappable: true });
    }
  }, [corridors, visibility, scheduleCommit, demandTubes, showDemandTubes]);

  const hasCorridors = corridors.length > 0;
  const hasTubes = showDemandTubes && (demandTubes?.length ?? 0) > 0;
  if (!hasCorridors && !hasTubes) {
    return (
      <div
        className={`rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-500 text-sm ${className}`}
        style={{ height, minHeight: 200 }}
      >
        Sin corredores ni tubos para dibujar. Marcá «Ver tubos» y rango de fechas o cargá corredores.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        <span className="text-violet-900 font-medium">Violeta</span>: tubo aproximado del mismo radio que usa el{' '}
        <strong>sync geográfico</strong> (2 km al eje de la polilínea del grupo).{' '}
        <span className="text-sky-900 font-medium">Azul / naranja</span>: cajas de corredor (editables con los
        vértices). Los tubos no se editan acá.
      </p>
      <div
        ref={containerRef}
        className={`w-full z-0 rounded-xl overflow-hidden border border-gray-200 ${className}`}
        style={{ height, minHeight: 280 }}
      />
    </div>
  );
}
