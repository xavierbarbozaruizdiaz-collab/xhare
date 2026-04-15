'use client';

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { Point } from '@/types';
import { DEMAND_SYNC_CORRIDOR_METERS, tubePolygonFromPolyline } from '@/lib/polylineTube';
import {
  boundsToBox,
  boundsToContainingFlatTopHex,
  DEFAULT_CORRIDOR_HEX_EDGE_M,
  hexGridCellsInPolygon,
  hexRingToLeafletLatLngs,
  leafletRingToHexLatLngs,
  parseHexLatlngFromZone,
} from '@/lib/corridorZoneHex';

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

/** Payload al guardar una zona editada en el mapa (bbox + hexágono). */
export type CorridorZoneEditPayload = CorridorZoneBox & {
  hex_latlng: Array<{ lat: number; lng: number }>;
};

/** Polilínea base de un grupo `demand_route_groups` (sync geo) para el tubo visual. */
export type DemandTubeLayer = {
  id: string;
  polyline: Point[];
  label: string;
  requested_date: string;
  passenger_count: number;
  /** Eje resuelto desde `trip_requests` porque `base_polyline` del grupo no servía. */
  axis_fallback?: boolean;
};

type ZoneMeta = { corridorId: string; kind: 'origin' | 'destination' };

type PmPolygon = L.Polygon & { pm?: { enable: (opts?: Record<string, unknown>) => void } };

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

type Props = {
  corridors: AdminCorridorMapItem[];
  visibility: CorridorLayerVisibility;
  onZoneEdited: (corridorId: string, kind: 'origin' | 'destination', payload: CorridorZoneEditPayload) => void;
  /** Grupos de demanda con `base_polyline` (mismo criterio de tubo que sync ~2 km). */
  demandTubes?: DemandTubeLayer[];
  showDemandTubes?: boolean;
  /** Lado aproximado de cada celda hexagonal de vista (~150 m). */
  corridorHexCellEdgeM?: number;
  /** Si true: celdas y zona macro sin relleno (solo contornos, estilo referencia móvil). */
  corridorZonesOutlineOnly?: boolean;
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
 * Mapa OSM + Geoman: tubos violeta (grupos sync) bajo hexágonos de corredor editables (zona = bbox + `hex_latlng` en DB).
 */
export default function AdminCorridorsMap({
  corridors,
  visibility,
  onZoneEdited,
  demandTubes = [],
  showDemandTubes = false,
  corridorHexCellEdgeM = DEFAULT_CORRIDOR_HEX_EDGE_M,
  corridorZonesOutlineOnly = false,
  height = 'min(52vh, 480px)',
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onZoneEditedRef = useRef(onZoneEdited);
  onZoneEditedRef.current = onZoneEdited;

  const scheduleCommit = useCallback((meta: ZoneMeta, layer: L.Polygon) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const b = layer.getBounds();
      const raw = layer.getLatLngs();
      const ring0 = Array.isArray(raw[0]) ? (raw[0] as L.LatLng[]) : (raw as L.LatLng[]);
      const hex = leafletRingToHexLatLngs(ring0);
      const box = boundsToBox(b);
      if (hex.length === 6) {
        onZoneEditedRef.current(meta.corridorId, meta.kind, { ...box, hex_latlng: hex });
      } else {
        const fallback = boundsToContainingFlatTopHex(b);
        onZoneEditedRef.current(meta.corridorId, meta.kind, { ...box, hex_latlng: fallback });
      }
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
        const axisNote = t.axis_fallback
          ? '<br/><em style="font-size:11px;color:#5b21b6">Eje desde trip_requests (fallback).</em>'
          : '';
        const tubePopup =
          `<strong>Tubo sync (~${DEMAND_SYNC_CORRIDOR_METERS / 1000} km)</strong><br/><span style="font-size:12px;color:#444">${escapePopup(t.label)}<br/>Fecha: ${escapePopup(t.requested_date)} · ${t.passenger_count} plaza(s)<br/>Grupo <code>${escapePopup(t.id.slice(0, 8))}…</code>${axisNote}</span>`;
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
      const macroFill = corridorZonesOutlineOnly ? 0 : active ? 0.18 : 0.06;
      const macroWeight = corridorZonesOutlineOnly ? 2.5 : active ? 2 : 1;
      const macroDash =
        !active && corridorZonesOutlineOnly
          ? ('5 5' as const)
          : !active && !corridorZonesOutlineOnly
            ? ('6 6' as const)
            : undefined;

      const cellFill = corridorZonesOutlineOnly ? 0 : active ? 0.1 : 0.04;
      const cellWeight = corridorZonesOutlineOnly ? 1.5 : 1;

      const attachHex = (poly: L.Polygon, meta: ZoneMeta, title: string) => {
        (poly as PmPolygon).pm?.enable({ preventMarkerRemoval: true });
        poly.bindPopup(
          `<strong>${escapePopup(c.name)}</strong><br/><span style="font-size:12px;color:#444">${escapePopup(title)}<br/>Arrastrá los vértices del contorno para ajustar la zona (la malla fina es solo referencia visual).</span>`
        );
        poly.on('pm:update', () => {
          scheduleCommit(meta, poly);
        });
      };

      const drawMacroWithGrid = (
        zone: Record<string, unknown>,
        bounds: L.LatLngBounds,
        show: boolean,
        meta: ZoneMeta,
        title: string,
        stroke: string,
        fill: string
      ) => {
        if (!show) return;
        const stored = parseHexLatlngFromZone(zone);
        const ring = stored ?? boundsToContainingFlatTopHex(bounds);
        const { cells, effectiveEdgeM, capped } = hexGridCellsInPolygon(ring, corridorHexCellEdgeM);
        const cellHint = capped
          ? ` · malla ${Math.round(effectiveEdgeM)} m (tope ${cells.length} celdas)`
          : ` · malla ~${Math.round(effectiveEdgeM)} m (${cells.length} celdas)`;
        for (const cell of cells) {
          L.polygon(hexRingToLeafletLatLngs(cell), {
            color: stroke,
            fillColor: fill,
            fillOpacity: cellFill,
            weight: cellWeight,
            opacity: 1,
            pmIgnore: true,
          } as PathOptsPm).addTo(group);
        }
        const poly = L.polygon(hexRingToLeafletLatLngs(ring), {
          color: stroke,
          fillColor: fill,
          fillOpacity: macroFill,
          weight: macroWeight,
          ...(macroDash ? { dashArray: macroDash } : {}),
        }).addTo(group);
        attachHex(poly, meta, `${title}${cellHint}`);
        for (const p of ring) {
          allCorners.push(L.latLng(p.lat, p.lng));
        }
      };

      if (oB) {
        drawMacroWithGrid(
          c.origin_zone,
          oB,
          showOrigin,
          { corridorId: c.id, kind: 'origin' },
          `Origen · prioridad ${c.sort_priority}${active ? '' : ' · inactivo'} · ${c.slug}`,
          '#0369a1',
          '#0284c7'
        );
      }
      if (dB) {
        drawMacroWithGrid(
          c.destination_zone,
          dB,
          showDest,
          { corridorId: c.id, kind: 'destination' },
          `Destino · prioridad ${c.sort_priority}${active ? '' : ' · inactivo'} · ${c.slug}`,
          '#c2410c',
          '#ea580c'
        );
      }
    }

    if (allCorners.length > 0) {
      map.fitBounds(L.latLngBounds(allCorners), { padding: [40, 40], maxZoom: 11 });
    } else {
      map.setView([-25.35, -57.45], 9);
    }

    const mpm = (map as MapWithPm).pm;
    mpm?.disableGlobalEditMode();
    if (corridors.length > 0) {
      mpm?.enableGlobalEditMode({ snappable: true });
    }

    const inv = window.setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(inv);
  }, [
    corridors,
    visibility,
    scheduleCommit,
    demandTubes,
    showDemandTubes,
    corridorHexCellEdgeM,
    corridorZonesOutlineOnly,
  ]);

  const hasCorridors = corridors.length > 0;
  const hasTubes = showDemandTubes && (demandTubes?.length ?? 0) > 0;
  const showNoDataOverlay = !hasCorridors && !hasTubes;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        <span className="text-violet-900 font-medium">Violeta</span>: tubo aproximado del mismo radio que usa el{' '}
        <strong>sync geográfico</strong> (2 km al eje de la polilínea del grupo).{' '}
        <span className="text-sky-900 font-medium">Azul / naranja</span>: contorno editable + malla hexagonal de
        referencia (~{Math.round(corridorHexCellEdgeM)} m por celda; la clasificación sigue el contorno guardado). Los
        tubos no se editan acá.
      </p>
      <div
        className={`relative w-full z-0 rounded-xl overflow-hidden border border-gray-200 ${className}`}
        style={{ height, minHeight: 280 }}
      >
        {showNoDataOverlay && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center bg-white/90 p-4 text-center text-sm text-gray-700 pointer-events-none">
            <div className="max-w-md">
              <p className="font-semibold text-gray-900 mb-2">No hay capas que dibujar todavía</p>
              <p className="mb-1">
                Si la tabla de corredores está vacía: en Supabase falta la migración{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">058_corridors…</code> o no hay filas en{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">corridors</code>.
              </p>
              <p>
                Si esperabas <strong>tubos violeta</strong>: en esas fechas no hay grupos con polilínea usable (ni en{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">demand_route_groups.base_polyline</code> ni en el
                pedido base vía <code className="text-xs bg-gray-100 px-1 rounded">trip_requests</code>). Corré el sync
                de demanda o ampliá el rango de fechas.
              </p>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full min-h-[280px]" style={{ height }} />
      </div>
    </div>
  );
}
