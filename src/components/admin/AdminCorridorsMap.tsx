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
  hexGridCellsTouchingPolygonGlobal,
  hexRingToLeafletLatLngs,
  leafletRingToHexLatLngs,
  leafletRingToPolygonLatLngs,
  parseCityPolygonsFromZone,
  parseHexLatlngFromZone,
  parsePolygonLatlngFromZone,
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
  hex_latlng?: Array<{ lat: number; lng: number }>;
  polygon_latlng?: Array<{ lat: number; lng: number }>;
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
  /** Si se define, habilita dibujar un polígono contenedor para ese corredor/zona. */
  drawTarget?: ZoneMeta | null;
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
  drawTarget = null,
  height = 'min(52vh, 480px)',
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onZoneEditedRef = useRef(onZoneEdited);
  onZoneEditedRef.current = onZoneEdited;
  const drawTargetRef = useRef<ZoneMeta | null>(drawTarget);
  drawTargetRef.current = drawTarget;

  const scheduleCommit = useCallback((meta: ZoneMeta, layer: L.Polygon) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const b = layer.getBounds();
      const raw = layer.getLatLngs();
      const ring0 = Array.isArray(raw[0]) ? (raw[0] as L.LatLng[]) : (raw as L.LatLng[]);
      const polygon = leafletRingToPolygonLatLngs(ring0);
      const box = boundsToBox(b);
      if (polygon.length >= 3) {
        onZoneEditedRef.current(meta.corridorId, meta.kind, { ...box, polygon_latlng: polygon });
      } else {
        const fallback = boundsToContainingFlatTopHex(b);
        onZoneEditedRef.current(meta.corridorId, meta.kind, { ...box, hex_latlng: fallback });
      }
    }, 650);
  }, []);

  const commitNow = useCallback((meta: ZoneMeta, layer: L.Polygon) => {
    const b = layer.getBounds();
    const raw = layer.getLatLngs();
    const ring0 = Array.isArray(raw[0]) ? (raw[0] as L.LatLng[]) : (raw as L.LatLng[]);
    const polygon = leafletRingToPolygonLatLngs(ring0);
    const box = boundsToBox(b);
    if (polygon.length >= 3) {
      onZoneEditedRef.current(meta.corridorId, meta.kind, { ...box, polygon_latlng: polygon });
    } else {
      const fallback = boundsToContainingFlatTopHex(b);
      onZoneEditedRef.current(meta.corridorId, meta.kind, { ...box, hex_latlng: fallback });
    }
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

    const mpm = (map as MapWithPm).pm;
    mpm?.addControls({
      position: 'topleft',
      drawPolygon: true,
      drawRectangle: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawMarker: false,
      drawText: false,
      cutPolygon: false,
      dragMode: false,
      rotateMode: false,
      editMode: false,
      removalMode: false,
    });
    map.on('pm:create', (e: L.LeafletEvent & { layer?: L.Layer }) => {
      const target = drawTargetRef.current;
      const layer = e.layer;
      if (!target || !(layer instanceof L.Polygon)) {
        if (layer && 'remove' in layer && typeof layer.remove === 'function') layer.remove();
        return;
      }
      // Dejar visible la figura recién dibujada mientras se persiste, para evitar el "parpadeo/desaparición".
      overlayRef.current?.addLayer(layer);
      commitNow(target, layer);
    });

    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      (map as MapWithPm).pm?.disableGlobalEditMode();
      (map as MapWithPm).pm?.removeControls();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [commitNow, scheduleCommit]);

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
        const cityPolysAll = parseCityPolygonsFromZone(zone);
        const cityPolys = cityPolysAll.filter((cp) => cp.active);
        const rings =
          cityPolysAll.length > 0
            ? cityPolys.map((cp) => cp.polygon_latlng)
            : [parsePolygonLatlngFromZone(zone) ?? parseHexLatlngFromZone(zone) ?? boundsToContainingFlatTopHex(bounds)];
        if (rings.length === 0) return;
        let totalCells = 0;
        let cappedAny = false;
        let effectiveSum = 0;
        for (const ring of rings) {
          const { cells, effectiveEdgeM, capped } = hexGridCellsTouchingPolygonGlobal(ring, corridorHexCellEdgeM);
          totalCells += cells.length;
          effectiveSum += effectiveEdgeM;
          if (capped) cappedAny = true;
          for (const cell of cells) {
            L.polygon(hexRingToLeafletLatLngs(cell), {
              color: stroke,
              fillColor: fill,
              fillOpacity: corridorZonesOutlineOnly ? 0 : cellFill,
              weight: corridorZonesOutlineOnly ? 1.1 : cellWeight,
              opacity: corridorZonesOutlineOnly ? 0.9 : 1,
              pmIgnore: true,
            } as PathOptsPm).addTo(group);
          }
        }
        const effectiveAvg = rings.length > 0 ? effectiveSum / rings.length : corridorHexCellEdgeM;
        const cellHint = cappedAny
          ? ` · malla ${Math.round(effectiveAvg)} m (tope ${totalCells} celdas)`
          : ` · malla ~${Math.round(effectiveAvg)} m (${totalCells} celdas)`;

        const editableRing = rings[0];
        const poly = L.polygon(hexRingToLeafletLatLngs(editableRing), {
          color: stroke,
          fillColor: fill,
          fillOpacity: macroFill,
          weight: macroWeight,
          ...(macroDash ? { dashArray: macroDash } : {}),
        }).addTo(group);
        attachHex(poly, meta, `${title}${cellHint}`);
        for (const ring of rings) {
          for (const p of ring) {
            allCorners.push(L.latLng(p.lat, p.lng));
          }
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
    drawTarget,
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
        tubos no se editan acá. Usá la herramienta de polígono para redibujar la zona seleccionada.
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
