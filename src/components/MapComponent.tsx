'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getRoutePolyline } from '@/lib/routing/route-validator';
import { distanceMeters } from '@/lib/geo';

export type PassengerPoint = { lat: number; lng: number; label?: string | null };

interface MapComponentProps {
  pickup: { lat: number; lng: number; label?: string } | null;
  dropoff: { lat: number; lng: number; label?: string } | null;
  waypoints?: Array<{ lat: number; lng: number; label?: string }>;
  /** Puntos de subida de pasajeros (solicitudes) para mostrar en el mapa cuando se publica desde solicitudes */
  passengerPickups?: PassengerPoint[];
  /** Puntos de bajada de pasajeros (solicitudes) para mostrar en el mapa cuando se publica desde solicitudes */
  passengerDropoffs?: PassengerPoint[];
  onPickupSelect: (point: { lat: number; lng: number; label?: string }) => void;
  onDropoffSelect: (point: { lat: number; lng: number; label?: string }) => void;
  onRouteStatsChange?: (stats: { distanceMeters: number; durationSeconds: number } | null) => void;
  /** Si lo indica el padre (ej. foco en campo Origen/Destino), el mapa usa este modo para el próximo clic */
  activeMode?: 'pickup' | 'dropoff' | null;
}

export default function MapComponent({
  pickup,
  dropoff,
  waypoints = [],
  passengerPickups = [],
  passengerDropoffs = [],
  onPickupSelect,
  onDropoffSelect,
  onRouteStatsChange,
  activeMode: activeModeProp = null,
}: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropoffMarkerRef = useRef<L.Marker | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const passengerMarkersRef = useRef<L.Marker[]>([]);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const [mode, setMode] = useState<'pickup' | 'dropoff'>('pickup');
  const [locating, setLocating] = useState(false);
  const clickHandlerRef = useRef<L.LeafletMouseEventHandlerFn | null>(null);

  // Modo efectivo: si el padre indica activeMode (ej. foco en Origen/Destino), usarlo; si no, el interno
  const effectiveMode = activeModeProp ?? mode;

  // Sincronizar modo interno cuando no está controlado desde fuera
  useEffect(() => {
    if (activeModeProp != null) return;
    if (!pickup) setMode('pickup');
    else if (!dropoff) setMode('dropoff');
  }, [pickup, dropoff, activeModeProp]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false }).setView([-25.2637, -57.5759], 12);
    mapRef.current = map;
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    setTimeout(() => mapRef.current?.invalidateSize(), 100);
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
      waypointMarkersRef.current = [];
      passengerMarkersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (clickHandlerRef.current) {
      mapRef.current.off('click', clickHandlerRef.current);
    }
    const handleMapClick = async (e: L.LeafletMouseEvent) => {
      let point: { lat: number; lng: number; label?: string } = { lat: e.latlng.lat, lng: e.latlng.lng };
      try {
        const response = await fetch(
          `/api/geocode/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`
        );
        if (response.ok) {
          const data = await response.json();
          point = { ...point, label: data.display_name || `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` };
        } else {
          point = { ...point, label: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` };
        }
      } catch {
        point = { ...point, label: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` };
      }
      // Primer clic = origen, segundo clic = destino; si ya hay ambos, usa el modo efectivo (mapa o foco en campo)
      if (!pickup) {
        onPickupSelect(point);
      } else if (!dropoff) {
        onDropoffSelect(point);
      } else {
        if (effectiveMode === 'pickup') onPickupSelect(point);
        else onDropoffSelect(point);
      }
    };
    mapRef.current.on('click', handleMapClick);
    clickHandlerRef.current = handleMapClick;
  }, [effectiveMode, pickup, dropoff, onPickupSelect, onDropoffSelect]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (pickup) {
      const existing = pickupMarkerRef.current;
      const onMap = existing && mapRef.current.hasLayer(existing);
      if (existing && onMap) {
        existing.setLatLng([pickup.lat, pickup.lng]);
      } else {
        if (existing) {
          try { existing.remove(); } catch (_) {}
          pickupMarkerRef.current = null;
        }
        const icon = L.divIcon({
          className: 'custom-marker',
          html: '<div style="background-color:red;width:24px;height:24px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:12px;">1</div>',
        });
        const m = L.marker([pickup.lat, pickup.lng], { icon }).addTo(mapRef.current);
        m.setZIndexOffset(500);
        pickupMarkerRef.current = m;
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }
  }, [pickup]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (dropoff) {
      const existing = dropoffMarkerRef.current;
      const onMap = existing && mapRef.current.hasLayer(existing);
      if (existing && onMap) {
        existing.setLatLng([dropoff.lat, dropoff.lng]);
      } else {
        if (existing) {
          try { existing.remove(); } catch (_) {}
          dropoffMarkerRef.current = null;
        }
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="background-color:green;width:24px;height:24px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:12px;">${waypoints.length + 2}</div>`,
        });
        const m = L.marker([dropoff.lat, dropoff.lng], { icon }).addTo(mapRef.current);
        m.setZIndexOffset(500);
        dropoffMarkerRef.current = m;
      }
    } else if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.remove();
      dropoffMarkerRef.current = null;
    }
  }, [dropoff, waypoints.length]);

  useEffect(() => {
    if (!mapRef.current) return;
    waypointMarkersRef.current.forEach(m => m.remove());
    waypointMarkersRef.current = [];
    waypoints.forEach((wp, i) => {
      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background-color:#3b82f6;width:22px;height:22px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:11px;">${i + 2}</div>`,
      });
      const marker = L.marker([wp.lat, wp.lng], { icon }).addTo(mapRef.current!);
      marker.setZIndexOffset(500);
      waypointMarkersRef.current.push(marker);
    });
  }, [waypoints]);

  useEffect(() => {
    if (!mapRef.current) return;
    passengerMarkersRef.current.forEach(m => m.remove());
    passengerMarkersRef.current = [];
    passengerPickups.forEach((p) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: '<div style="background:#6b7280;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(mapRef.current!);
      marker.setZIndexOffset(-500);
      const tooltip = `Subida: ${String(p.label || '').slice(0, 50)}`;
      if (p.label) marker.bindTooltip(tooltip, { permanent: false });
      passengerMarkersRef.current.push(marker);
    });
    passengerDropoffs.forEach((p) => {
      const icon = L.divIcon({
        className: 'border-0 bg-transparent',
        html: '<div style="background:#64748b;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(mapRef.current!);
      marker.setZIndexOffset(-500);
      const tooltip = `Bajada: ${String(p.label || '').slice(0, 50)}`;
      if (p.label) marker.bindTooltip(tooltip, { permanent: false });
      passengerMarkersRef.current.push(marker);
    });
  }, [passengerPickups, passengerDropoffs]);

  useEffect(() => {
    if (!mapRef.current || !pickup || !dropoff || !onRouteStatsChange) return;
    const loadRoute = async () => {
      try {
        const origin = { lat: pickup.lat, lng: pickup.lng };
        const dest = { lat: dropoff.lat, lng: dropoff.lng };
        const driverWaypoints = waypoints.map(w => ({ lat: w.lat, lng: w.lng }));
        const passengerPoints = [...passengerPickups.map(p => ({ lat: p.lat, lng: p.lng })), ...passengerDropoffs.map(p => ({ lat: p.lat, lng: p.lng }))];
        const allIntermediate = [...driverWaypoints, ...passengerPoints];
        const waypointsOnly =
          allIntermediate.length > 0
            ? allIntermediate.sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b))
            : undefined;
        const points = await getRoutePolyline(origin, dest, waypointsOnly);
        if (routePolylineRef.current) {
          routePolylineRef.current.remove();
          routePolylineRef.current = null;
        }
        if (points.length >= 2) {
          const latlngs: L.LatLngExpression[] = points.map(p => [p.lat, p.lng]);
          routePolylineRef.current = L.polyline(latlngs, { color: '#16a34a', weight: 4 }).addTo(mapRef.current!);
          let bounds = routePolylineRef.current.getBounds();
          if (passengerPickups.length > 0 || passengerDropoffs.length > 0) {
            [...passengerPickups, ...passengerDropoffs].forEach(p => bounds.extend([p.lat, p.lng]));
          }
          mapRef.current!.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
          let distanceM = 0;
          for (let i = 0; i < points.length - 1; i++) {
            distanceM += distanceMeters(points[i], points[i + 1]);
          }
          const durationSeconds = Math.round((distanceM / 1000 / 40) * 3600);
          onRouteStatsChange({ distanceMeters: distanceM, durationSeconds });
        } else {
          onRouteStatsChange(null);
        }
      } catch {
        onRouteStatsChange(null);
      }
    };
    loadRoute();
    return () => {
      if (routePolylineRef.current) {
        routePolylineRef.current.remove();
        routePolylineRef.current = null;
      }
    };
  }, [pickup, dropoff, waypoints, onRouteStatsChange, passengerPickups, passengerDropoffs]);

  useEffect(() => {
    if (!mapRef.current) return;
    const allPoints: Array<[number, number]> = [];
    if (pickup) allPoints.push([pickup.lat, pickup.lng]);
    if (dropoff) allPoints.push([dropoff.lat, dropoff.lng]);
    waypoints.forEach(wp => allPoints.push([wp.lat, wp.lng]));
    passengerPickups.forEach(p => allPoints.push([p.lat, p.lng]));
    passengerDropoffs.forEach(p => allPoints.push([p.lat, p.lng]));
    if (allPoints.length === 0) return;
    const bounds = new L.LatLngBounds(allPoints[0], allPoints[0]);
    allPoints.forEach(p => bounds.extend(p));
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [pickup, dropoff, waypoints, passengerPickups, passengerDropoffs]);

  const handleMyLocation = () => {
    setLocating(true);
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización');
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        if (mapRef.current) mapRef.current.setView([latitude, longitude], 15);
        let point: { lat: number; lng: number; label?: string } = { lat: latitude, lng: longitude };
        try {
          const response = await fetch(
            `/api/geocode/reverse?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`
          );
          if (response.ok) {
            const data = await response.json();
            point = { ...point, label: data.display_name || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` };
          }
        } catch (_) {}
        if (effectiveMode === 'pickup') onPickupSelect(point);
        else onDropoffSelect(point);
        setLocating(false);
      },
      () => {
        alert('No se pudo obtener tu ubicación');
        setLocating(false);
      }
    );
  };

  return (
    <div className="relative h-full w-full">
      {/* Panel arriba a la izquierda; el zoom está en top-right para no encimarse */}
      <div className="absolute top-2 left-2 z-[1000] flex flex-col gap-2 min-w-0">
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setMode('pickup')}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${effectiveMode === 'pickup' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Recogida
          </button>
          <button
            type="button"
            onClick={() => setMode('dropoff')}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${effectiveMode === 'dropoff' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Destino
          </button>
        </div>
        <button
          type="button"
          onClick={handleMyLocation}
          disabled={locating}
          className="px-3 py-1.5 rounded text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap w-fit"
        >
          {locating ? 'Buscando...' : 'Mi ubicación'}
        </button>
      </div>
      {/* Instrucción: solo hace falta clicar en el mapa; el orden es origen → destino */}
      {!pickup && (
        <div className="absolute bottom-2 left-2 right-2 z-[999] px-3 py-2 bg-green-600 text-white text-sm rounded shadow text-center">
          Haz clic en el mapa para elegir el origen (primer clic)
        </div>
      )}
      {pickup && !dropoff && (
        <div className="absolute bottom-2 left-2 right-2 z-[999] px-3 py-2 bg-green-600 text-white text-sm rounded shadow text-center">
          Haz clic en el mapa para elegir el destino (segundo clic)
        </div>
      )}
      {pickup && dropoff && (
        <div className="absolute bottom-2 left-2 right-2 z-[999] px-3 py-2 bg-gray-700 text-white text-sm rounded shadow text-center">
          {effectiveMode === 'pickup'
            ? 'Haz clic en el mapa para cambiar el origen (o haz foco en el campo Origen abajo).'
            : effectiveMode === 'dropoff'
              ? 'Haz clic en el mapa para cambiar el destino (o haz foco en el campo Destino abajo).'
              : 'Origen y destino listos. Haz foco en Origen o Destino abajo, o usa los botones, para cambiar uno.'}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
