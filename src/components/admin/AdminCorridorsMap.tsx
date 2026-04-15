'use client';

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { Point } from '@/types';
import { DEMAND_SYNC_CORRIDOR_METERS, tubePolygonFromPolyline } from '@/lib/polylineTube';
import {
  type CityPolygon,
  DEFAULT_CORRIDOR_HEX_EDGE_M,
  hexGridCellsTouchingPolygonGlobal,
  hexRingToLeafletLatLngs,
  parseCityPolygonsFromZone,
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
  city_polygons?: Array<{
    id: string;
    name: string;
    active: boolean;
    polygon_latlng: Array<{ lat: number; lng: number }>;
  }>;
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

function polygonFromLeaflet(latlngsRaw: L.LatLng[] | L.LatLng[][]): Array<{ lat: number; lng: number }> {
  const ring = Array.isArray(latlngsRaw[0]) ? (latlngsRaw[0] as L.LatLng[]) : (latlngsRaw as L.LatLng[]);
  const out = ring.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a.lat === b.lat && a.lng === b.lng) out.pop();
  }
  return out.length >= 3 ? out : [];
}

function bboxFromCityPolygons(cities: CityPolygon[]): CorridorZoneBox | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const c of cities) {
    for (const p of c.polygon_latlng) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
  }
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  return { minLat, maxLat, minLng, maxLng };
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
  /** Mantener para compatibilidad del caller; hex se dibuja siempre solo bordes. */
  corridorZonesOutlineOnly?: boolean;
  /** Mantener para compatibilidad del caller; edición manual desactivada. */
  drawTarget?: ZoneMeta | null;
  /** Si está definido, solo esa ciudad (id) se habilita para edición. */
  editCityId?: string | null;
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
  corridorZonesOutlineOnly = true,
  drawTarget = null,
  editCityId = null,
  height = 'min(52vh, 480px)',
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const onZoneEditedRef = useRef(onZoneEdited);
  onZoneEditedRef.current = onZoneEdited;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([-25.35, -57.45], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Edición manual desactivada: la delimitación pasa por importación automática de ciudades.
    (map as MapWithPm).pm?.removeControls();

    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
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
      const macroFill = 0;
      const macroWeight = active ? 1.6 : 1.2;
      const macroDash = !active ? ('5 5' as const) : undefined;
      const cellFill = 0;
      const cellWeight = 1.05;

      const drawMacroWithGrid = (
        zone: Record<string, unknown>,
        bounds: L.LatLngBounds,
        show: boolean,
        kind: 'origin' | 'destination',
        title: string,
        stroke: string,
        fill: string
      ) => {
        if (!show) return;
        const cityPolysAll = parseCityPolygonsFromZone(zone);
        const cityPolys = cityPolysAll.filter((cp) => cp.active);
        const rings = cityPolys.map((cp) => cp.polygon_latlng);
        if (rings.length === 0) return;
        let totalCells = 0;
        let cappedAny = false;
        let effectiveSum = 0;
        for (const ring of rings) {
          const { cells, effectiveEdgeM, capped } = hexGridCellsTouchingPolygonGlobal(ring, corridorHexCellEdgeM);
          totalCells += cells.length;
          effectiveSum += effectiveEdgeM;
          if (capped) cappedAny = true;
          if (!corridorZonesOutlineOnly) {
            for (const cell of cells) {
              L.polygon(hexRingToLeafletLatLngs(cell), {
                color: stroke,
                fillColor: fill,
                fillOpacity: cellFill,
                weight: cellWeight,
                opacity: 0.92,
                pmIgnore: true,
              } as PathOptsPm).addTo(group);
            }
          }
        }
        const effectiveAvg = rings.length > 0 ? effectiveSum / rings.length : corridorHexCellEdgeM;
        const cellHint = corridorZonesOutlineOnly
          ? ` · solo contorno (${rings.length} ciudad(es) activa(s))`
          : cappedAny
            ? ` · malla ${Math.round(effectiveAvg)} m (tope ${totalCells} celdas)`
            : ` · malla ~${Math.round(effectiveAvg)} m (${totalCells} celdas)`;

        for (let idx = 0; idx < rings.length; idx++) {
          const ring = rings[idx];
          const city = cityPolys[idx];
          const cityName = city?.name ?? 'Ciudad';
          const canEdit =
            !!drawTarget &&
            drawTarget.corridorId === c.id &&
            drawTarget.kind === kind &&
            !!city &&
            (!editCityId || city.id === editCityId);
          const border = L.polygon(hexRingToLeafletLatLngs(ring), {
            color: stroke,
            fillColor: fill,
            fillOpacity: macroFill,
            weight: macroWeight,
            ...(macroDash ? { dashArray: macroDash } : {}),
            pmIgnore: !canEdit,
          } as PathOptsPm).addTo(group);
          border.bindPopup(
            `<strong>${escapePopup(c.name)}</strong><br/><span style="font-size:12px;color:#444">${escapePopup(
              `${title} · ${cityName}${cellHint}`
            )}<br/>Zona automática de ciudad (Central).</span>`
          );
          if (canEdit && city && (border as PmPolygon).pm) {
            (border as PmPolygon).pm?.enable({
              preventMarkerRemoval: true,
              snappable: true,
            });
            let saveTimer: ReturnType<typeof setTimeout> | null = null;
            const persistCityEdit = () => {
              if (saveTimer) clearTimeout(saveTimer);
              saveTimer = setTimeout(() => {
                saveTimer = null;
                const nextPoly = polygonFromLeaflet(border.getLatLngs() as L.LatLng[] | L.LatLng[][]);
                if (nextPoly.length < 3) return;
                const nextAll = cityPolysAll.map((cp) =>
                  cp.id === city.id ? { ...cp, polygon_latlng: nextPoly } : cp
                );
                const bbox = bboxFromCityPolygons(nextAll);
                if (!bbox) return;
                onZoneEditedRef.current(c.id, kind, {
                  ...bbox,
                  city_polygons: nextAll.map((cp) => ({
                    id: cp.id,
                    name: cp.name,
                    active: cp.active,
                    polygon_latlng: cp.polygon_latlng,
                  })),
                });
              }, 220);
            };
            // `pm:update` no siempre dispara en global edit mode; estos sí lo hacen al editar vértices.
            border.on('pm:markerdragend', persistCityEdit);
            border.on('pm:vertexadded', persistCityEdit);
            border.on('pm:vertexremoved', persistCityEdit);
            border.on('pm:edit', persistCityEdit);
            border.on('pm:update', persistCityEdit);
            border.on('remove', () => {
              if (saveTimer) clearTimeout(saveTimer);
            });
          }
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
          'origin',
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
          'destination',
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
    if (drawTarget && editCityId) {
      // Con edición global activa + pmIgnore selectivo, solo la ciudad objetivo queda editable.
      mpm?.enableGlobalEditMode({
        snappable: true,
        allowSelfIntersection: false,
      });
    }

    const inv = window.setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(inv);
  }, [
    corridors,
    visibility,
    demandTubes,
    showDemandTubes,
    corridorHexCellEdgeM,
    corridorZonesOutlineOnly,
    drawTarget,
    editCityId,
  ]);

  const hasCorridors = corridors.length > 0;
  const hasTubes = showDemandTubes && (demandTubes?.length ?? 0) > 0;
  const showNoDataOverlay = !hasCorridors && !hasTubes;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        <span className="text-violet-900 font-medium">Violeta</span>: tubo aproximado del mismo radio que usa el{' '}
        <strong>sync geográfico</strong> (2 km al eje de la polilínea del grupo).{' '}
        <span className="text-sky-900 font-medium">Azul / naranja</span>: malla hexagonal automática por ciudades de
        Central (~{Math.round(corridorHexCellEdgeM)} m por celda), visible solo por bordes.
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
