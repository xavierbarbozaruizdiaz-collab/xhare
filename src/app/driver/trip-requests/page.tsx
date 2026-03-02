'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import UserRoleBadge from '@/components/UserRoleBadge';
import PageLoading from '@/components/PageLoading';

const RouteThumbnail = dynamic(() => import('@/components/RouteThumbnail'), { ssr: false });

function shortLabel(label: string | null, max = 50): string {
  if (!label) return '—';
  const t = label.trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

function formatRequestedDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRequestedDateLong(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

type GroupByMode = 'date' | 'none' | 'date_and_destination' | 'date_and_time';

/** Normaliza hora a HH:MM para agrupar. */
function timeKey(t: string | null | undefined): string {
  if (!t) return '08:00';
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '08:00';
}

/** Agrupa solicitudes por requested_date (clave YYYY-MM-DD). */
function groupRequestsByDate(requests: any[]): { date: string; label: string; items: any[] }[] {
  const byDate = new Map<string, any[]>();
  for (const r of requests) {
    const key = r.requested_date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(r);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      label: formatRequestedDateLong(date || null),
      items,
    }));
}

/** Clave de destino "similar" para agrupar: inicio del label (misma zona/calle). */
function destinationKey(r: any): string {
  const s = (r.destination_label || '').trim();
  if (!s) return '—';
  return s.length <= 45 ? s : s.slice(0, 45) + '…';
}

/** Agrupa por fecha y luego por destino similar (inicio del destination_label). */
function groupRequestsByDateAndDestination(requests: any[]): { date: string; dateLabel: string; groups: { destLabel: string; items: any[] }[] }[] {
  const byDate = new Map<string, any[]>();
  for (const r of requests) {
    const key = r.requested_date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(r);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const byDest = new Map<string, any[]>();
      for (const r of items) {
        const key = destinationKey(r);
        if (!byDest.has(key)) byDest.set(key, []);
        byDest.get(key)!.push(r);
      }
      const groups = Array.from(byDest.entries()).map(([destLabel, destItems]) => ({ destLabel, items: destItems }));
      return {
        date,
        dateLabel: formatRequestedDateLong(date || null),
        groups,
      };
    });
}

/** Agrupa por fecha y luego por hora de recogida (requested_time). */
function groupRequestsByDateAndTime(requests: any[]): { date: string; dateLabel: string; timeGroups: { timeLabel: string; timeKey: string; items: any[] }[] }[] {
  const byDate = new Map<string, any[]>();
  for (const r of requests) {
    const key = r.requested_date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(r);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const byTime = new Map<string, any[]>();
      for (const r of items) {
        const key = timeKey(r.requested_time);
        if (!byTime.has(key)) byTime.set(key, []);
        byTime.get(key)!.push(r);
      }
      const timeGroups = Array.from(byTime.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([timeKey, timeItems]) => ({
          timeKey,
          timeLabel: timeKey,
          items: timeItems,
        }));
      return {
        date,
        dateLabel: formatRequestedDateLong(date || null),
        timeGroups,
      };
    });
}

export default function DriverTripRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupByMode>('date');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (profile?.role !== 'driver' && profile?.role !== 'admin') {
        router.push('/my-rides');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('trip_requests')
        .select('id, origin_lat, origin_lng, destination_lat, destination_lng, origin_label, destination_label, requested_date, requested_time, seats, created_at')
        .eq('status', 'pending')
        .gte('requested_date', today)
        .order('requested_date', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRequests(data || []);
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  function renderRequestCard(req: any) {
    const isSelected = selectedIds.has(req.id);
    const selectedReq = selectedIds.size > 0 ? requests.find((r: any) => selectedIds.has(r.id)) : null;
    const selectedDate = selectedReq?.requested_date ?? null;
    const selectedTime = selectedReq != null ? timeKey(selectedReq.requested_time) : null;
    const canSelect = !selectedDate || (selectedDate === req.requested_date && (groupBy !== 'date_and_time' || selectedTime === timeKey(req.requested_time)));
    const hasCoords = req.origin_lat != null && req.origin_lng != null && req.destination_lat != null && req.destination_lng != null;
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex gap-4">
          {hasCoords && (
            <div className="flex-shrink-0">
              <RouteThumbnail
                origin={{ lat: req.origin_lat, lng: req.origin_lng }}
                destination={{ lat: req.destination_lat, lng: req.destination_lng }}
                width="200px"
                height="110px"
              />
            </div>
          )}
          <div className="flex flex-1 justify-between items-start gap-3 min-w-0">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {canSelect && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(req.id)) next.delete(req.id);
                      else next.add(req.id);
                      return next;
                    });
                  }}
                  className="mt-1 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900" title={req.origin_label ?? ''}>
                  {shortLabel(req.origin_label)}
                </p>
                <p className="text-sm text-gray-500 mt-0.5" title={req.destination_label ?? ''}>
                  → {shortLabel(req.destination_label)}
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  {groupBy === 'none' ? `📅 ${formatRequestedDate(req.requested_date)} · 🕐 ${timeKey(req.requested_time)} · ` : ''}
                  {(groupBy === 'date' || groupBy === 'date_and_destination') ? `🕐 ${timeKey(req.requested_time)} · ` : ''}
                  {Number(req.seats ?? 1)} asiento{(req.seats ?? 1) !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <Link
              href={`/publish?trip_request_id=${encodeURIComponent(req.id)}`}
              className="flex-shrink-0 btn-primary text-sm py-2 px-3"
            >
              Crear viaje para esta
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <header className="bg-white border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 min-h-[48px]">
          <Link href="/my-rides" className="text-lg font-bold text-green-600 shrink-0">Xhare</Link>
          <div className="flex items-center gap-2">
            <Link href="/publish" className="btn-primary text-sm py-2 px-3 shrink-0">
              Publicar viaje
            </Link>
            <Link href="/my-rides" className="btn-tertiary text-sm">Mis viajes</Link>
            <button
              type="button"
              onClick={() => supabase.auth.signOut().then(() => router.push('/'))}
              className="btn-tertiary text-sm"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
        <div className="hidden lg:flex flex-wrap items-center gap-2 pb-2">
          <UserRoleBadge />
        </div>
      </header>

      <div className="app-mobile-px py-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Solicitudes de trayecto</h1>
          <Link href="/my-rides" className="text-sm font-medium text-green-600 hover:text-green-700">← Mis viajes</Link>
        </div>
        <p className="text-gray-600 mb-6 text-sm">
          Pasajeros que no encontraron viajes y guardaron su trayecto. Se muestran solo solicitudes de hoy en adelante. Podés crear un viaje para una solicitud o seleccionar varias de la misma fecha y crear un solo viaje para todas.
        </p>

        {requests.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Agrupar por:</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGroupBy('date')}
                className={groupBy === 'date' ? 'tab-segment-active text-sm' : 'tab-segment text-sm'}
              >
                Fecha
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('date_and_destination')}
                className={groupBy === 'date_and_destination' ? 'tab-segment-active text-sm' : 'tab-segment text-sm'}
              >
                Fecha y destino
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('date_and_time')}
                className={groupBy === 'date_and_time' ? 'tab-segment-active text-sm' : 'tab-segment text-sm'}
              >
                Fecha y hora
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('none')}
                className={groupBy === 'none' ? 'tab-segment-active text-sm' : 'tab-segment text-sm'}
              >
                Lista plana
              </button>
            </div>
          </div>
        )}

        {requests.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <p className="text-gray-500 mb-4">No hay solicitudes pendientes.</p>
            <Link href="/publish" className="btn-primary">
              Publicar un viaje
            </Link>
          </div>
        ) : (
          <>
            {selectedIds.size > 0 && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-green-800">
                  {selectedIds.size} solicitud{selectedIds.size !== 1 ? 'es' : ''} seleccionada{selectedIds.size !== 1 ? 's' : ''}
                </span>
                <Link
                  href={`/publish?trip_request_id=${encodeURIComponent(Array.from(selectedIds).join(','))}`}
                  className="btn-primary text-sm py-2 px-3"
                >
                  Crear viaje para las {selectedIds.size} seleccionadas
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="btn-tertiary text-sm py-0"
                >
                  Desmarcar
                </button>
              </div>
            )}
            <p className="text-sm text-gray-500 mb-4">
              Total: {requests.length} solicitud{requests.length !== 1 ? 'es' : ''} pendiente{requests.length !== 1 ? 's' : ''}
              {' · Vista: '}
              {groupBy === 'date' ? 'por fecha' : groupBy === 'date_and_destination' ? 'por fecha y destino similar' : groupBy === 'date_and_time' ? 'por fecha y hora' : 'lista plana'}
            </p>
            {groupBy === 'none' ? (
              <ul className="space-y-4">
                {requests.map((req: any) => renderRequestCard(req))}
              </ul>
            ) : groupBy === 'date' ? (
              <div className="space-y-8">
                {groupRequestsByDate(requests).map((group) => (
                  <section key={group.date}>
                    <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <span>📅</span>
                      {group.label}
                      <span className="text-sm font-normal text-gray-500">
                        ({group.items.length} solicitud{group.items.length !== 1 ? 'es' : ''})
                      </span>
                    </h2>
                    <ul className="space-y-4">
                      {group.items.map((req: any) => (
                        <li key={req.id}>{renderRequestCard(req)}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : groupBy === 'date_and_time' ? (
              <div className="space-y-8">
                {groupRequestsByDateAndTime(requests).map((dateGroup) => (
                  <section key={dateGroup.date}>
                    <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <span>📅</span>
                      {dateGroup.dateLabel}
                    </h2>
                    <div className="space-y-6">
                      {dateGroup.timeGroups.map((tg) => (
                        <div key={`${dateGroup.date}-${tg.timeKey}`}>
                          <h3 className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-2">
                            <span>🕐</span> {tg.timeLabel}
                            <span className="text-gray-400">
                              ({tg.items.length} solicitud{tg.items.length !== 1 ? 'es' : ''})
                            </span>
                          </h3>
                          <ul className="space-y-4">
                            {tg.items.map((req: any) => (
                              <li key={req.id}>{renderRequestCard(req)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {groupRequestsByDateAndDestination(requests).map((dateGroup) => (
                  <section key={dateGroup.date}>
                    <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <span>📅</span>
                      {dateGroup.dateLabel}
                    </h2>
                    <div className="space-y-6">
                      {dateGroup.groups.map((destGroup, idx) => (
                        <div key={`${dateGroup.date}-${idx}`}>
                          <h3 className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-2">
                            <span>→</span> {shortLabel(destGroup.destLabel, 55)}
                            <span className="text-gray-400">
                              ({destGroup.items.length} solicitud{destGroup.items.length !== 1 ? 'es' : ''})
                            </span>
                          </h3>
                          <ul className="space-y-4">
                            {destGroup.items.map((req: any) => (
                              <li key={req.id}>{renderRequestCard(req)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
